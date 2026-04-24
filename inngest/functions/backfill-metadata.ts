import { inngest } from "@/inngest/client";
import { getSettings, resolveApifyToken } from "@/lib/config/settings";
import { scrapeProfiles } from "@/lib/apify/actors";
import { fetchProfileMetadataDirect, InstagramDirectError, sleep } from "@/lib/instagram/direct";
import { createAdminClient } from "@/lib/supabase/admin";
import { logCrawl, logError } from "@/lib/pipeline/persist";

// Backfill basic profile metadata (followers, following, posts, bio,
// external_link, is_private, is_verified) for a batch of usernames.
//
// Two paths:
//  1. FREE — direct fetch to IG's web_profile_info endpoint using the burner
//     IG session cookie from Settings. Throttled per profile to keep the
//     account safe.
//  2. PAID — Apify profile actor in batches. Fallback when no IG cookie is
//     configured. Faster but costs Apify credits.
//
// Path is chosen at runtime by checking `settings.instagram_session_cookie`.

const APIFY_BATCH = 50;
const COOKIE_BATCH = 10;
const COOKIE_DELAY_MS = 2500; // 2.5s between profiles in cookie mode

export const backfillMetadata = inngest.createFunction(
  {
    id: "backfill-metadata",
    name: "Backfill follower counts / metadata",
    retries: 2,
    concurrency: [
      { limit: 1, key: "event.data.crawl_job_id" }, // 1 backfill per crawl (cookie path = sequential anyway)
      { limit: 3 },
    ],
  },
  { event: "leads/backfill.metadata.requested" },
  async ({ event, step }) => {
    const { usernames, crawl_job_id } = event.data as {
      usernames: string[];
      crawl_job_id?: string | null;
    };
    if (!usernames || usernames.length === 0) return { processed: 0 };

    const settings = await step.run("load-settings", () => getSettings());
    const cookie = settings.instagram_session_cookie?.trim() || process.env.INSTAGRAM_SESSION_COOKIE?.trim() || null;
    const useFreePath = !!cookie;

    if (useFreePath) {
      // -------- FREE: direct fetch with IG burner cookie --------
      const batches: string[][] = [];
      for (let i = 0; i < usernames.length; i += COOKIE_BATCH) {
        batches.push(usernames.slice(i, i + COOKIE_BATCH));
      }

      let updated = 0;
      let scraped = 0;
      let halt = false;

      for (let bi = 0; bi < batches.length; bi++) {
        if (halt) break;
        const batch = batches[bi];
        const result = await step.run(`cookie-batch-${bi}`, async () => {
          const sb = createAdminClient();
          let s = 0, u = 0;
          for (const username of batch) {
            try {
              const p = await fetchProfileMetadataDirect({ username, sessionCookie: cookie });
              if (!p) {
                await sleep(COOKIE_DELAY_MS);
                continue;
              }
              s++;
              const { error } = await sb
                .from("leads")
                .update({
                  full_name: p.full_name,
                  bio: p.bio,
                  external_link: p.external_link,
                  followers: p.followers,
                  following: p.following,
                  posts: p.posts,
                  is_private: p.is_private,
                  is_verified: p.is_verified,
                })
                .eq("username", p.username);
              if (!error) u++;
            } catch (err) {
              const direct = err instanceof InstagramDirectError ? err : null;
              const msg = direct ? direct.message : (err as Error).message;
              await logError({
                context: "backfill.metadata.cookie",
                error_message: msg,
                payload: { username, batch_index: bi, status: direct?.status },
                crawl_job_id: crawl_job_id ?? null,
              });
              // Non-retryable IG error (cookie expired / challenge) → stop the
              // whole backfill so we don't burn the cookie or trigger more bans.
              if (direct && !direct.retryable) {
                return { s, u, halt: true };
              }
            }
            await sleep(COOKIE_DELAY_MS);
          }
          return { s, u, halt: false };
        });
        scraped += result.s;
        updated += result.u;
        halt = result.halt;
      }

      await logCrawl({
        crawl_job_id: crawl_job_id ?? null,
        profile_username: `backfill:${usernames.length}`,
        parent_username: null,
        action: "backfill_metadata",
        depth: 0,
        detail: `mode=cookie requested=${usernames.length} scraped=${scraped} updated=${updated} batches=${batches.length}${halt ? " HALTED" : ""}`,
      });

      return { processed: usernames.length, scraped, updated, batches: batches.length, mode: "cookie", halted: halt };
    }

    // -------- PAID: Apify profile actor in batches --------
    const token = resolveApifyToken(settings);
    if (!token) {
      await logError({
        context: "backfill.metadata",
        error_message: "No IG cookie AND no Apify token — cannot backfill metadata.",
        crawl_job_id: crawl_job_id ?? null,
      });
      return { processed: 0, error: "no-cookie-no-apify-token" };
    }

    const batches: string[][] = [];
    for (let i = 0; i < usernames.length; i += APIFY_BATCH) {
      batches.push(usernames.slice(i, i + APIFY_BATCH));
    }

    let updated = 0;
    let scraped = 0;
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const result = await step.run(`apify-batch-${bi}`, async () => {
        try {
          return await scrapeProfiles({ token, usernames: batch });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await logError({
            context: "backfill.metadata.batch",
            error_message: msg,
            payload: { batch, batch_index: bi },
            crawl_job_id: crawl_job_id ?? null,
          });
          return [];
        }
      });
      scraped += result.length;

      const wrote = await step.run(`update-apify-batch-${bi}`, async () => {
        if (result.length === 0) return 0;
        const sb = createAdminClient();
        let wroteCount = 0;
        for (const p of result) {
          const { error } = await sb
            .from("leads")
            .update({
              full_name: p.full_name,
              bio: p.bio,
              external_link: p.external_link,
              followers: p.followers,
              following: p.following,
              posts: p.posts,
              is_private: p.is_private,
              is_verified: p.is_verified,
            })
            .eq("username", p.username);
          if (!error) wroteCount++;
        }
        return wroteCount;
      });
      updated += wrote;
    }

    await logCrawl({
      crawl_job_id: crawl_job_id ?? null,
      profile_username: `backfill:${usernames.length}`,
      parent_username: null,
      action: "backfill_metadata",
      depth: 0,
      detail: `mode=apify requested=${usernames.length} scraped=${scraped} updated=${updated} batches=${batches.length}`,
    });

    return { processed: usernames.length, scraped, updated, batches: batches.length, mode: "apify" };
  },
);
