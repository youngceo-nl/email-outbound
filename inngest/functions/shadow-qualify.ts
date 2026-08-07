/*
 * Shadow mode for the evidence-first commercial qualification pipeline.
 *
 * Runs the new pipeline (lib/qualification/*) alongside the live gpt-4o-mini
 * scorer and records what it WOULD have decided. It writes only to
 * public.lead_qualification_shadow. It must never write to public.leads, never
 * change a lead's status, and never gate outreach — if you find yourself adding
 * an update to the leads table here, that is the cutover, not shadow mode, and
 * it belongs in a deliberate change to score-lead.ts instead.
 *
 * Instagram is not contacted. Evidence for the Instagram surface comes from the
 * lead row the metadata backfill already populated (lib/qualification/from-lead.ts),
 * so this costs no scraping budget, no session, and no proxy. Only the external
 * surfaces (bio link, YouTube) are fetched live.
 *
 * Cost per sampled lead is one Haiku extraction plus a handful of page fetches,
 * and a challenger call on the minority of high-impact decisions. That is
 * roughly two orders of magnitude more than the live scorer's $0.0001, which is
 * why sampling is on by default and the whole thing is off by default.
 */

import { inngest } from "@/inngest/client";
import { getSettings } from "@/lib/config/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { instagramEvidenceFromLead } from "@/lib/qualification/from-lead";
import { runCommercialQualification } from "@/lib/qualification/run";
import { createLlmClient } from "@/lib/qualification/providers";
import { logError } from "@/lib/pipeline/persist";

/** Per-lead extractor. Cheap enough to run on sampled volume. */
const EXTRACTOR_MODEL = "claude-haiku-4-5";
/** Only fires on high-impact decisions, so it can afford to be stronger. */
const CHALLENGER_MODEL = "claude-opus-5";

export const shadowQualify = inngest.createFunction(
  {
    id: "shadow-qualify",
    name: "Shadow-qualify lead (evidence-first pipeline)",
    // A shadow result is never load-bearing, so a failure must not consume
    // retry budget that real work needs.
    retries: 1,
    concurrency: [
      { limit: 4, key: "event.data.crawl_job_id" },
      { limit: 5 },
    ],
  },
  { event: "lead/shadow-qualify.requested" },
  async ({ event, step }) => {
    const { lead_id, legacy_status, legacy_score } = event.data;

    const settings = await step.run("load-settings", () => getSettings());

    if (!settings.shadow_qualification_enabled) {
      return { skipped: "shadow_disabled" };
    }

    const apiKey = settings.claude_api_key ?? process.env.ANTHROPIC_API_KEY ?? null;
    if (!apiKey) {
      return { skipped: "no_anthropic_key" };
    }

    const lead = await step.run("load-lead", async () => {
      const sb = createAdminClient();
      const { data, error } = await sb
        .from("leads")
        .select(
          "id, username, full_name, bio, external_link, is_private, is_verified, followers, following, posts, recent_posts",
        )
        .eq("id", lead_id)
        .single();
      if (error || !data) throw new Error(error?.message ?? "lead not found");
      return data;
    });

    const instagram = instagramEvidenceFromLead({
      username: lead.username,
      full_name: lead.full_name,
      bio: lead.bio,
      external_link: lead.external_link,
      is_private: !!lead.is_private,
      is_verified: !!lead.is_verified,
      followers: lead.followers,
      following: lead.following,
      posts: lead.posts,
      recent_posts: lead.recent_posts,
    });

    /*
     * Deliberately NOT wrapped in step.run. Inngest memoizes step output as
     * JSON, and a full evidence snapshot round-tripped through that would both
     * bloat the run history and risk mangling the payload we intend to store
     * verbatim for replay. A retry re-runs acquisition, which is acceptable
     * because nothing here has side effects on the lead.
     */
    let result: Awaited<ReturnType<typeof runCommercialQualification>> | null = null;
    let failure: string | null = null;

    try {
      result = await runCommercialQualification({
        instagram,
        leadId: lead.id,
        llm: createLlmClient({ provider: "anthropic", model: EXTRACTOR_MODEL, apiKey }),
        challengerLlm: createLlmClient({
          provider: "anthropic",
          model: CHALLENGER_MODEL,
          apiKey,
        }),
      });
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }

    await step.run("persist-shadow", async () => {
      const sb = createAdminClient();
      const decision = result?.decision ?? null;

      await sb.from("lead_qualification_shadow").insert({
        lead_id: lead.id,
        username: lead.username,
        outcome: decision?.decision ?? null,
        decision_mode: decision?.mode ?? null,
        score: decision?.icp_scores?.total_icp_score ?? null,
        certainty: decision?.certainty ?? null,
        reason_codes: decision?.decision_reasons ?? [],
        challenger_verdict:
          decision?.challenger_agreement == null
            ? null
            : decision.challenger_agreement
              ? "agrees"
              : "disagrees",
        legacy_status: legacy_status ?? null,
        legacy_score: legacy_score ?? null,
        agrees: agreementBetween(decision?.decision ?? null, legacy_status ?? null),
        snapshot: result?.snapshot ?? null,
        extraction: result?.extraction ?? null,
        decision,
        acquisition_version: result?.snapshot?.versions.acquisition_version ?? null,
        timings_ms: result?.timings_ms ?? null,
        usage: result?.usage ?? null,
        error: failure,
      });
    });

    if (failure) {
      // Recorded, not thrown: a shadow failure is an infrastructure fact and
      // must not colour the lead or trip the batch watchdog.
      await logError({
        context: "shadow-qualify",
        error_message: failure,
        payload: { lead_id: lead.id, username: lead.username },
        crawl_job_id: event.data.crawl_job_id ?? null,
      }).catch(() => {});
      return { status: "error", error: failure };
    }

    return {
      status: result?.decision.decision ?? null,
      score: result?.decision.icp_scores?.total_icp_score ?? null,
      certainty: result?.decision.certainty ?? null,
      legacy_status: legacy_status ?? null,
    };
  },
);

/**
 * Compares the two pipelines on the only axis they share: does this lead go
 * forward or not. Their vocabularies differ (the new pipeline has data_retry
 * and scoring_error, which are non-verdicts), so anything without a real
 * verdict on either side returns null rather than being scored as a mismatch.
 */
export function agreementBetween(
  shadowOutcome: string | null,
  legacyStatus: string | null,
): boolean | null {
  const shadow = forwardVerdict(shadowOutcome);
  const legacy = forwardVerdict(legacyStatus);
  if (shadow === null || legacy === null) return null;
  return shadow === legacy;
}

function forwardVerdict(value: string | null): boolean | null {
  if (value === "qualified" || value === "review") return true;
  if (value === "rejected") return false;
  return null;
}
