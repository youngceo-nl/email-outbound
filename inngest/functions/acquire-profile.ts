import { inngest } from "@/inngest/client";
import { getSettings, resolveScrapingBeeKeys } from "@/lib/config/settings";
import { collectCommercialEvidence } from "@/lib/evidence/collect";
import { assessSufficiency } from "@/lib/evidence/sufficiency";
import {
  buildAcquisitionPool,
  type AcquisitionPoolEntry,
} from "@/lib/instagram/cookie-pool";
import { AcquisitionTimeoutError, acquireInstagramEvidence } from "@/lib/instagram/steel-acquisition";
import { advanceRunLead, createEvidenceSnapshot } from "@/lib/qualification/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { logCrawl, logError } from "@/lib/pipeline/persist";
import { quarantineAccount } from "@/lib/instagram/quarantine";
import { shouldQuarantine } from "@/lib/instagram/quarantine-policy";
import {
  qualificationEventForAcquisition,
  selectAcquisitionIdentity,
} from "@/lib/pipeline/canonical-events";

export const acquireProfile = inngest.createFunction(
  {
    id: "acquire-profile",
    name: "Acquire Instagram profile evidence",
    retries: 1,
    /*
     * Stays at 1: each acquisition holds a Steel browser session and a
     * rate-limited Instagram cookie, so parallelism invites challenges and
     * quarantine. This is the hardest throttle in the pipeline.
     */
    concurrency: { limit: 1 },
  },
  { event: "lead/profile-acquisition.requested" },
  async ({ event, step }) => {
    const { lead_id, username, crawl_job_id = null, event_index = 0, run_id = null } = event.data;
    const settings = await step.run("load-settings", () => getSettings(true));
    const identity = selectAcquisitionIdentity(buildAcquisitionPool(settings), event_index);

    await advanceRunLead({
      runId: run_id,
      username,
      stage: "acquiring",
      patch: {
        status: "running",
        acquisition_provider: "steel",
        identity_label: identity.accountUsername,
      },
    });

    await step.run("log-acquisition-started", () =>
      logCrawl({
        crawl_job_id,
        profile_username: username,
        parent_username: null,
        action: "profile_acquisition_started",
        depth: 0,
        detail: acquisitionIdentityDetail(identity),
      }),
    );

    let acquisition: Awaited<ReturnType<typeof acquireInstagramEvidence>>;
    try {
      acquisition = await step.run("acquire-profile", () =>
        acquireInstagramEvidence({
          username,
          identity,
          steelApiKey: settings.steel_api_key ?? process.env.STEEL_API_KEY ?? null,
          steelBaseUrl: settings.steel_base_url ?? process.env.STEEL_BASE_URL ?? null,
        steelCfClientId: settings.steel_cf_client_id ?? process.env.STEEL_CF_CLIENT_ID ?? null,
        steelCfClientSecret: settings.steel_cf_client_secret ?? process.env.STEEL_CF_CLIENT_SECRET ?? null,
        }),
      );
    } catch (err) {
      if (!(err instanceof AcquisitionTimeoutError)) throw err;
      /*
       * Deliberately NOT the same path as a real challenge/block below: a
       * timeout is evidence the browser backend is unhealthy, not that this
       * account's cookie or proxy is bad. Quarantining it here would blame
       * the wrong thing — found 2026-08-03 when a degrading self-hosted Steel
       * instance made session-open calls climb from 10s to 63s before it
       * crashed, with nothing bounding how long a single lead could run.
       */
      await step.run("log-acquisition-timeout", () =>
        logError({
          context: "profile-acquisition",
          error_message: err.message,
          payload: { username, account: identity.accountUsername },
          crawl_job_id,
        }),
      );
      await advanceRunLead({
        runId: run_id,
        username,
        stage: "acquiring",
        patch: { status: "acquisition_failed", acquisition_status: "timeout", error_message: err.message },
      });
      return { status: "timeout", qualified: false };
    }

    if (acquisition.status !== "captured") {
      if (shouldQuarantine(acquisition.status, acquisition.report.errors)) {
        await step.run("quarantine-account", () =>
          quarantineAccount({
            accountUsername: identity.accountUsername,
            leadUsername: username,
            proxyUrl: identity.proxyUrl,
            steelProfileId: identity.steelProfileId,
            sessionId: acquisition.sessionId,
            challenge: acquisition.challenge ?? acquisition.report.errors.join("; ").slice(0, 200),
            crawlJobId: crawl_job_id,
          }),
        );
      }
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
            account: identity.accountUsername,
            proxy: proxyEndpoint(identity.proxyUrl),
            steel_profile_id: identity.steelProfileId,
            steel_session_id: acquisition.sessionId,
            challenge: acquisition.challenge,
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
          detail: `status=${acquisition.status} ${acquisitionIdentityDetail(identity)}`,
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
          steel_session_id: acquisition.sessionId ?? null,
          error_message: acquisition.challenge ?? acquisition.report.errors.join("; ").slice(0, 300),
        },
      });
      return { status: acquisition.status, qualified: false };
    }

    await step.run("persist-profile-metadata", async () => {
      const sb = createAdminClient();
      const profile = acquisition.report.profile as Record<string, unknown>;
      const posts = [...acquisition.report.pinned_posts, ...acquisition.report.recent_posts].map((post) => ({
        caption: post.caption,
        likes: post.likes,
        comments: post.comments,
        views: post.views,
        taken_at: post.taken_at,
        is_reel: post.is_reel,
        is_pinned: post.is_pinned,
      }));
      const { error } = await sb
        .from("leads")
        .update({
          full_name: profile.display_name ?? null,
          bio: profile.biography ?? null,
          external_link: profile.external_link ?? null,
          followers: profile.followers ?? null,
          following: profile.following ?? null,
          posts: profile.total_posts ?? null,
          is_private: profile.is_private ?? false,
          is_verified: profile.is_verified ?? false,
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
      patch: {
        acquisition_status: acquisition.status,
        steel_session_id: acquisition.sessionId ?? null,
      },
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
          `${acquisitionIdentityDetail(identity)} snapshot=${snapshotRow.id} ` +
          `captured=${acquisition.report.field_completeness.captured_fields.length} ` +
          `unknown=${acquisition.report.field_completeness.unknown_fields.length}`,
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

function acquisitionIdentityDetail(identity: AcquisitionPoolEntry): string {
  return (
    `account=${identity.accountUsername} proxy=${proxyEndpoint(identity.proxyUrl)} ` +
    `steel_profile=${identity.steelProfileId}`
  );
}

function proxyEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname}:${url.port}`;
  } catch {
    return "invalid";
  }
}
