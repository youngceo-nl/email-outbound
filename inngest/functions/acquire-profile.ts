import { inngest } from "@/inngest/client";
import { getSettings } from "@/lib/config/settings";
import { collectCommercialEvidence } from "@/lib/evidence/collect";
import { assessSufficiency } from "@/lib/evidence/sufficiency";
import { acquireInstagramEvidenceViaApify } from "@/lib/instagram/apify-acquisition";
import { advanceRunLead, createEvidenceSnapshot } from "@/lib/qualification/repository";
import { resolveScrapingBeeKeys } from "@/lib/config/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { logCrawl, logError } from "@/lib/pipeline/persist";
import { qualificationEventForAcquisition } from "@/lib/pipeline/canonical-events";

export const acquireProfile = inngest.createFunction(
  {
    id: "acquire-profile",
    name: "Acquire Instagram profile evidence",
    retries: 1,
    /*
     * Was 1 because each Steel acquisition held a browser session and a
     * rate-limited Instagram cookie, so parallelism risked challenges and
     * quarantine. Apify manages its own proxy pool and carries no cookie, so
     * the only real ceiling is Apify account memory (1024MB per actor run).
     */
    concurrency: { limit: 3 },
  },
  { event: "lead/profile-acquisition.requested" },
  async ({ event, step }) => {
    const { lead_id, username, crawl_job_id = null, run_id = null } = event.data;
    const settings = await step.run("load-settings", () => getSettings(true));

    await advanceRunLead({
      runId: run_id,
      username,
      stage: "acquiring",
      patch: { status: "running", acquisition_provider: "apify" },
    });

    await step.run("log-acquisition-started", () =>
      logCrawl({
        crawl_job_id,
        profile_username: username,
        parent_username: null,
        action: "profile_acquisition_started",
        depth: 0,
        detail: "provider=apify",
      }),
    );

    const acquisition = await step.run("acquire-profile", () =>
      acquireInstagramEvidenceViaApify({ username }),
    );

    if (acquisition.status !== "captured") {
      /*
       * No quarantine branch under Apify: there is no managed cookie or proxy
       * identity to pause. A failure here is Apify's or the profile's, never an
       * account we own — pausing something would be misattributing blame.
       */
      await step.run("persist-acquisition-failure", async () => {
        const sb = createAdminClient();
        await sb
          .from("leads")
          .update({ qualification_state: "error", backfill_error: acquisition.status })
          .eq("id", lead_id);
      });
      await step.run("log-acquisition-error", () =>
        logError({
          context: "profile-acquisition",
          error_message: `Profile acquisition ${acquisition.status} for @${username}`,
          payload: {
            username,
            provider: "apify",
            errors: acquisition.errors,
          },
          crawl_job_id,
        }),
      );
      await step.run("log-acquisition-failed", () =>
        logCrawl({
          crawl_job_id,
          profile_username: username,
          parent_username: null,
          action: "profile_acquisition_failed",
          depth: 0,
          status: "failure",
          detail: `status=${acquisition.status} provider=apify`,
        }),
      );
      await advanceRunLead({
        runId: run_id,
        username,
        // Deliberately parked at the acquisition slot rather than advanced —
        // the chain ends here for any non-captured status, and that silent drop
        // is the single biggest invisible bucket in the pipeline.
        stage: "acquiring",
        patch: {
          status: "acquisition_failed",
          acquisition_status: acquisition.status,
          error_message: acquisition.errors.join("; ").slice(0, 300) || acquisition.status,
        },
      });
      return { status: acquisition.status, qualified: false };
    }

    await step.run("persist-profile-metadata", async () => {
      const sb = createAdminClient();
      const ig = acquisition.instagram;
      // InstagramEvidence rather than a provider-shaped report, so this stays
      // identical whichever acquisition path produced it.
      const posts = [...ig.pinned_posts, ...ig.recent_posts].map((post) => ({
        caption: post.caption,
        likes: post.likes,
        comments: post.comments,
        views: post.views,
        taken_at: post.taken_at,
        is_reel: post.is_video,
        is_pinned: post.is_pinned,
      }));
      const { error } = await sb
        .from("leads")
        .update({
          full_name: ig.display_name,
          bio: ig.bio,
          external_link: ig.external_link,
          followers: ig.followers,
          following: ig.following,
          posts: ig.total_posts,
          is_private: ig.is_private,
          is_verified: ig.is_verified,
          recent_posts: posts,
          backfill_error: null,
          qualification_state: "processing",
        })
        .eq("id", lead_id);
      if (error) throw new Error(error.message);
    });

    await advanceRunLead({
      runId: run_id,
      username,
      stage: "profile_persisted",
      patch: { acquisition_status: acquisition.status },
    });

    await advanceRunLead({ runId: run_id, username, stage: "external_evidence" });
    const snapshot = await step.run("collect-evidence-snapshot", async () => {
      const sufficiency = assessSufficiency(acquisition.instagram);
      return collectCommercialEvidence({
        instagram: acquisition.instagram,
        dataQuality: sufficiency.data_quality,
        leadId: lead_id,
        /*
         * Previously omitted, which silently disabled both. Without a
         * ScrapingBee key the fetcher returns the free-fetch result for
         * JS-shell landing pages (external.ts:211), and without a YouTube key
         * the collector falls back to rate-limited HTML scraping — so the
         * pipeline ran degraded and nothing said so.
         */
        external: { scrapingBeeApiKey: resolveScrapingBeeKeys(settings)[0] ?? null },
        youtube: { apiKey: settings.youtube_api_key ?? process.env.YOUTUBE_API_KEY ?? null },
      });
    });
    const snapshotRow = await step.run("persist-evidence-snapshot", () =>
      createEvidenceSnapshot({ snapshot, leadId: lead_id }),
    );

    await step.run("log-profile-acquired", () =>
      logCrawl({
        crawl_job_id,
        profile_username: username,
        parent_username: null,
        action: "profile_acquired",
        depth: 0,
        status: "success",
        detail:
          `provider=apify snapshot=${snapshotRow.id} ` +
          `posts=${acquisition.instagram.recent_posts.length} ` +
          `followers=${acquisition.instagram.followers ?? "unknown"}`,
      }),
    );

    await advanceRunLead({
      runId: run_id,
      username,
      stage: "snapshot_stored",
      patch: { evidence_snapshot_id: snapshotRow.id },
    });

    const next = qualificationEventForAcquisition({
      status: acquisition.status,
      leadId: lead_id,
      snapshotId: snapshotRow.id,
      crawlJobId: crawl_job_id,
      runId: run_id,
    });
    if (next) {
      await advanceRunLead({ runId: run_id, username, stage: "qualification_queued" });
      await step.sendEvent("request-qualification", next);
    }

    return { status: "captured", snapshot_id: snapshotRow.id };
  },
);
