import { inngest } from "@/inngest/client";
import { getSettings } from "@/lib/config/settings";
import { collectCommercialEvidence } from "@/lib/evidence/collect";
import { assessSufficiency } from "@/lib/evidence/sufficiency";
import {
  buildAcquisitionPool,
  type AcquisitionPoolEntry,
} from "@/lib/instagram/cookie-pool";
import {
  acquireInstagramEvidence,
} from "@/lib/instagram/steel-acquisition";
import { createEvidenceSnapshot } from "@/lib/qualification/repository";
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
    concurrency: { limit: 1 },
  },
  { event: "lead/profile-acquisition.requested" },
  async ({ event, step }) => {
    const { lead_id, username, crawl_job_id = null, event_index = 0 } = event.data;
    const settings = await step.run("load-settings", () => getSettings(true));
    const identity = selectAcquisitionIdentity(buildAcquisitionPool(settings), event_index);

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

    const acquisition = await step.run("acquire-profile", () =>
      acquireInstagramEvidence({ username, identity }),
    );

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

    const snapshot = await step.run("collect-evidence-snapshot", async () => {
      const sufficiency = assessSufficiency(acquisition.instagram);
      return collectCommercialEvidence({
        instagram: acquisition.instagram,
        dataQuality: sufficiency.data_quality,
        leadId: lead_id,
      });
    });
    const snapshotRow = await step.run("persist-evidence-snapshot", () =>
      createEvidenceSnapshot({ snapshot, leadId: lead_id }),
    );

    const next = qualificationEventForAcquisition({
      status: acquisition.status,
      leadId: lead_id,
      snapshotId: snapshotRow.id,
      crawlJobId: crawl_job_id,
    });
    if (next) await step.sendEvent("request-qualification", next);

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
