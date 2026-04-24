import { inngest } from "@/inngest/client";
import { getSettings, resolveApifyToken } from "@/lib/config/settings";
import { scrapeFollowingDetailedWithFallback } from "@/lib/pipeline/scrape-following";
import { bulkUpsertDiscoveredLeads, logCrawl, logError } from "@/lib/pipeline/persist";
import { createAdminClient } from "@/lib/supabase/admin";

// Entry point: a seed's crawl starts here at depth 0.
// FOLLOWING-ONLY MODE: scrape the seed's following list, bulk-upsert every new
// username as a `pending` lead with the metadata from the following actor
// (username, full_name, is_private, is_verified). NO automatic profile/post
// scrape. The user clicks "Process" per row when they want the full pipeline.
export const crawlSeed = inngest.createFunction(
  {
    id: "crawl-seed",
    name: "Crawl seed account (following-only)",
    retries: 2,
    concurrency: { limit: 3, key: "event.data.seed_id" },
  },
  { event: "crawl/seed.requested" },
  async ({ event, step }) => {
    const { crawl_job_id, seed_id, seed_username, profile_limit } = event.data;

    await step.run("mark-running", async () => {
      const sb = createAdminClient();
      await sb
        .from("crawl_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", crawl_job_id);
    });

    const settings = await step.run("load-settings", () => getSettings(true));
    const token = resolveApifyToken(settings);

    let r;
    try {
      r = await step.run("scrape-seed-following", () =>
        scrapeFollowingDetailedWithFallback({
          username: seed_username,
          settings,
          apifyToken: token,
          crawl_job_id,
          limitOverride: profile_limit ?? null,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logError({ context: "scrape.following.seed", error_message: msg, crawl_job_id });
      await markJobFailed(crawl_job_id, msg);
      throw err;
    }

    const inserted = await step.run("bulk-upsert", () =>
      bulkUpsertDiscoveredLeads(r.items, {
        crawl_depth: 1,
        source_seed_id: seed_id,
        parent_username: seed_username,
      }),
    );

    await step.run("set-counters", async () => {
      const sb = createAdminClient();
      await sb
        .from("crawl_jobs")
        .update({
          expected_profiles: inserted,
          profiles_scraped: inserted,
        })
        .eq("id", crawl_job_id);
    });

    await logCrawl({
      crawl_job_id,
      profile_username: seed_username,
      parent_username: null,
      action: "scraped_following",
      depth: 0,
      detail: `provider=${r.provider} total=${r.items.length} inserted_new=${inserted}`,
    });

    // Fire metadata backfill for all freshly-inserted usernames so the leads
    // page shows followers / bio / external_link without waiting for a manual
    // Process per row. Only the items we actually inserted (deduped).
    if (inserted > 0) {
      const freshUsernames = r.items.map((i) => i.username);
      await step.sendEvent("backfill-metadata", {
        name: "leads/backfill.metadata.requested" as const,
        data: { usernames: freshUsernames, crawl_job_id },
      });
    }

    await markJobCompleted(crawl_job_id);
    return { discovered: inserted };
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
