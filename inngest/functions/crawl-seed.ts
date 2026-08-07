import { inngest } from "@/inngest/client";
import { getSettings, resolveApifyTokens } from "@/lib/config/settings";
import { scrapeFollowingDetailedWithFallback } from "@/lib/pipeline/scrape-following";
import { bulkUpsertDiscoveredLeads, bumpFunnelCounters, logCrawl, logError } from "@/lib/pipeline/persist";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/types";

const PAGE_SIZE = 50;  // accounts fetched per Instagram API call
// Every crawl is full-account: it walks the following list to its end rather
// than stopping at a lead target, so this cap is only a runaway guard (~20k
// accounts) — not the normal stopping condition.
const MAX_PAGES = 400;

export const crawlSeed = inngest.createFunction(
  {
    id: "crawl-seed",
    name: "Crawl seed account (following-only)",
    retries: 2,
    concurrency: { limit: 3, key: "event.data.seed_id" },
  },
  { event: "crawl/seed.requested" },
  async ({ event, step }) => {
    const { crawl_job_id, seed_id, seed_username, provider_override } = event.data;

    await step.run("mark-running", async () => {
      const sb = createAdminClient();
      await sb
        .from("crawl_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", crawl_job_id);
    });

    const settings = await step.run("load-settings", () => getSettings(true));

    const effectiveSettings = provider_override
      ? { ...settings, following_scraper_provider: provider_override as AppSettings["following_scraper_provider"] }
      : settings;

    const apifyToken = resolveApifyTokens(settings);

    /*
     * Resume where the last run stopped. The Apify actor's free tier delivers
     * ~1,000 results per account per day and hands back a continuation token
     * (valid ~7 days) for the rest; without carrying that across runs, the
     * next day restarts at the top and spends its whole allowance
     * re-delivering accounts we already have. Quota is charged on delivery, so
     * de-duplicating our side recovers nothing.
     */
    const { data: seedCursor } = await createAdminClient()
      .from("seeds")
      .select("following_cursor, following_cursor_expires_at")
      .eq("id", seed_id)
      .maybeSingle();
    const cursorStillValid =
      seedCursor?.following_cursor &&
      (!seedCursor.following_cursor_expires_at ||
        new Date(seedCursor.following_cursor_expires_at).getTime() > Date.now());
    let cursor: string | null = cursorStillValid ? (seedCursor!.following_cursor as string) : null;
    let totalNew = 0;
    let totalScraped = 0;
    let pageIndex = 0;
    // The provider that actually ran, which under `auto` may not be the one
    // configured. Only this is safe to draw conclusions from afterwards.
    let lastProvider: string | null = null;
    const allNewUsernames: string[] = [];
    // Every item this seed's following list actually contains, new or not —
    // this feeds following_edges (lib/seeds/recommend.ts's network-overlap
    // signal), which needs the whole list, not just what got inserted as a
    // fresh lead. allNewUsernames above can't be reused for this: an account
    // already known from a different seed is a duplicate there (skipped) but
    // is still a real edge for *this* seed.
    const allScrapedUsernames: string[] = [];

    while (pageIndex < MAX_PAGES) {
      let r;
      try {
        r = await step.run(`scrape-page-${pageIndex}`, () =>
          scrapeFollowingDetailedWithFallback({
            username: seed_username,
            settings: effectiveSettings,
            apifyToken,
            crawl_job_id,
            // Playwright/Apify walk the whole list in one session regardless of
            // this number (fullAccount governs that); the cookie API pages
            // naturally at ~50 per call with cursor continuation, so it's the
            // one provider this value actually paces.
            limitOverride: PAGE_SIZE,
            fullAccount: true,
            startCursor: cursor,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await logError({ context: "scrape.following.seed", error_message: msg, crawl_job_id });
        await markJobFailed(crawl_job_id, msg);
        throw err;
      }

      if (r.items.length === 0) break;
      totalScraped += r.items.length;
      lastProvider = r.provider;
      allScrapedUsernames.push(...r.items.map((i) => i.username));

      const { inserted, duplicates, excluded } = await step.run(`bulk-upsert-${pageIndex}`, () =>
        bulkUpsertDiscoveredLeads(r.items, {
          crawl_depth: 1,
          source_seed_id: seed_id,
          parent_username: seed_username,
        }),
      );

      totalNew += inserted;
      // Live counter: the Activity page reads this while the run is still
      // going, so it is bumped per page rather than only in set-counters.
      // duplicates/excluded ride along so a run's full breakdown is visible in
      // its history row, not just the net new-lead count.
      if (inserted > 0 || duplicates > 0 || excluded > 0) {
        await step.run(`bump-found-${pageIndex}`, () =>
          bumpFunnelCounters({ crawl_job_id, found: inserted, duplicate: duplicates, excluded }),
        );
      }
      if (inserted > 0) {
        allNewUsernames.push(...r.items.map((i) => i.username));
      }

      // Wrapped in a step: a bare await re-runs on every Inngest replay, which
      // wrote the same line three times for a single page.
      await step.run(`log-page-${pageIndex}`, () =>
        logCrawl({
          crawl_job_id,
          profile_username: seed_username,
          parent_username: null,
          action: "scraped_following",
          depth: 0,
          detail:
            `provider=${r.provider} page=${pageIndex} total=${r.items.length} inserted_new=${inserted} duplicates=${duplicates} excluded=${excluded} cumulative_new=${totalNew}/full` +
            // A downgrade is the thing worth noticing in this log, so it goes
            // on the same line rather than only into error_logs.
            (r.fellBackFrom?.length
              ? ` FELL_BACK_FROM=${r.fellBackFrom.map((f) => f.provider).join(",")}`
              : ""),
        }),
      );

      // No cursor = end of following list — stop regardless
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
      pageIndex++;

      // Pause between Inngest steps so consecutive API pages don't fire back-to-back.
      // Each fetchFollowingDirect call resolves one page (limit=PAGE_SIZE=50), so the
      // in-function delay only fires within multi-page calls. This step.sleep covers
      // the Inngest-step-boundary gap.
      const delaySecs = Math.floor(Math.random() * 3) + 2; // 2–4 s
      await step.sleep(`inter-page-sleep-${pageIndex}`, `${delaySecs}s`);
    }

    /*
     * Persist the leftover cursor (or clear it when the list is finished) so a
     * later run picks up rather than restarting. Best-effort: failing to store
     * a cursor must never fail an otherwise-good crawl.
     */
    await step.run("persist-following-cursor", async () => {
      const sb = createAdminClient();
      await sb
        .from("seeds")
        .update({
          following_cursor: cursor,
          // The actor's tokens expire in about a week; a stale one is refused
          // above rather than spent on a run that cannot use it.
          following_cursor_expires_at: cursor
            ? new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString()
            : null,
        })
        .eq("id", seed_id);
    }).catch(() => {});

    await step.run("set-counters", async () => {
      const sb = createAdminClient();
      await Promise.all([
        sb
          .from("crawl_jobs")
          .update({
            expected_profiles: totalScraped,
            profiles_scraped: totalScraped,
            new_leads: totalNew,
          })
          .eq("id", crawl_job_id),
        sb.from("seeds").update({ following_count: totalScraped }).eq("id", seed_id),
      ]);
    });

    // Record who-follows-whom for the seed recommender's network-overlap
    // signal (lib/seeds/recommend.ts). Best-effort: an edges write failing is
    // never a reason to fail an otherwise-successful crawl.
    if (allScrapedUsernames.length > 0) {
      await step.run("record-following-edges", async () => {
        const sb = createAdminClient();
        const rows = allScrapedUsernames.map((followed_username) => ({ seed_username, followed_username }));
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const { error } = await sb
            .from("following_edges")
            .upsert(rows.slice(i, i + CHUNK), { onConflict: "seed_username,followed_username", ignoreDuplicates: true });
          if (error) {
            await logError({
              context: "crawl-seed.following-edges",
              error_message: error.message,
              payload: { seed_username, chunk: i },
              crawl_job_id: crawl_job_id ?? null,
            });
            break; // one bad chunk shouldn't retry-loop the whole edge write
          }
        }
      });
    }

    // Backfill metadata only for newly inserted leads.
    // backfill-metadata has concurrency: { limit: 1 } — one event at a time globally —
    // so we send the full list as a single event rather than splitting into parallel chunks.
    if (allNewUsernames.length > 0) {
      await step.sendEvent("backfill-metadata", {
        name: "leads/backfill.metadata.requested" as const,
        data: { usernames: allNewUsernames, crawl_job_id, event_index: 0 },
      });
    }

    // Only track cookie exhaustion — cookie is the only method with a hard cap
    // (~250 accounts). Apify handles its own pagination fully.
    // Keyed off the provider that actually ran, not the one requested: under
    // `auto` those differ, and the old code logged the request and so could
    // blame the cookie pool for an Apify run (or miss a real exhaustion).
    const isCookieRun = lastProvider === "cookie";
    if (isCookieRun) {
      await step.run("update-seed-exhaustion", async () => {
        const sb = createAdminClient();
        const { data: seed } = await sb
          .from("seeds")
          .select("exhausted_providers")
          .eq("id", seed_id)
          .single();
        const current: string[] = seed?.exhausted_providers ?? [];
        let updated: string[];
        // Only mark as exhausted if we actually fetched accounts but none were new.
        // totalScraped===0 means the API returned nothing (network/bug), not that the list is empty.
        if (totalScraped > 0 && totalNew === 0 && !cursor) {
          updated = current.includes("cookie") ? current : [...current, "cookie"];
        } else {
          updated = current.filter((p) => p !== "cookie");
        }
        if (JSON.stringify(updated) !== JSON.stringify(current)) {
          await sb.from("seeds").update({ exhausted_providers: updated }).eq("id", seed_id);
        }
      });
    }

    await markJobCompleted(crawl_job_id);
    return { discovered: totalNew, pages: pageIndex + 1 };
  },
);

async function markJobFailed(id: string, msg: string) {
  const sb = createAdminClient();
  await sb
    .from("crawl_jobs")
    .update({ status: "failed", error_message: msg.slice(0, 4000), finished_at: new Date().toISOString() })
    .eq("id", id);
}
async function markJobCompleted(id: string) {
  const sb = createAdminClient();
  await sb
    .from("crawl_jobs")
    .update({ status: "completed", finished_at: new Date().toISOString() })
    .eq("id", id);
}
