import { inngest } from "@/inngest/client";
import { getSettings } from "@/lib/config/settings";
import { logCrawl, logError } from "@/lib/pipeline/persist";
import { createLlmClient } from "@/lib/qualification/providers";
import { saveQualificationRun } from "@/lib/qualification/repository";
import { runCommercialQualification } from "@/lib/qualification/run";
import type { EvidenceSnapshot } from "@/lib/qualification/types";
import { createAdminClient } from "@/lib/supabase/admin";

const EXTRACTOR_MODEL = "claude-haiku-4-5";
const CHALLENGER_MODEL = "claude-opus-5";

export const qualifyLead = inngest.createFunction(
  {
    id: "qualify-lead",
    name: "Qualify persisted lead evidence",
    retries: 2,
    concurrency: [{ limit: 4, key: "event.data.crawl_job_id" }, { limit: 8 }],
  },
  { event: "lead/qualification.requested" },
  async ({ event, step }) => {
    const { lead_id, evidence_snapshot_id, crawl_job_id = null } = event.data;
    const settings = await step.run("load-settings", () => getSettings(true));
    const apiKey = settings.claude_api_key ?? process.env.ANTHROPIC_API_KEY ?? null;
    if (!apiKey) throw new Error("Anthropic API key is required for canonical qualification");

    const snapshot = await step.run("load-evidence-snapshot", async () => {
      const sb = createAdminClient();
      const { data, error } = await sb
        .from("lead_evidence_snapshots")
        .select("payload")
        .eq("id", evidence_snapshot_id)
        .eq("lead_id", lead_id)
        .single();
      if (error || !data) throw new Error(error?.message ?? "evidence snapshot not found");
      return data.payload as EvidenceSnapshot;
    });

    await logCrawl({
      crawl_job_id,
      profile_username: snapshot.username,
      parent_username: null,
      action: "qualification_started",
      depth: 0,
      detail: `snapshot=${evidence_snapshot_id}`,
    });

    let result: Awaited<ReturnType<typeof runCommercialQualification>>;
    try {
      result = await runCommercialQualification({
        instagram: snapshot.instagram,
        precollectedSnapshot: snapshot,
        leadId: lead_id,
        llm: createLlmClient({ provider: "anthropic", model: EXTRACTOR_MODEL, apiKey }),
        challengerLlm: createLlmClient({ provider: "anthropic", model: CHALLENGER_MODEL, apiKey }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logError({
        context: "canonical-qualification",
        error_message: message,
        payload: { lead_id, evidence_snapshot_id, username: snapshot.username },
        crawl_job_id,
      });
      throw error;
    }

    await step.run("persist-qualification", () =>
      saveQualificationRun({
        leadId: lead_id,
        existingSnapshotId: evidence_snapshot_id,
        snapshot,
        extraction: result.extraction,
        decision: result.decision,
      }),
    );

    await logCrawl({
      crawl_job_id,
      profile_username: snapshot.username,
      parent_username: null,
      action: result.decision.decision,
      depth: 0,
      status: "success",
      detail:
        `score=${result.decision.scores.commercial_fit} certainty=${result.decision.certainty} ` +
        `reasons=${result.decision.decision_reasons.join(",")} ` +
        `pipeline=${result.decision.versions.pipeline_version}`,
    });

    return {
      status: result.decision.decision,
      score: result.decision.scores.commercial_fit,
      certainty: result.decision.certainty,
      snapshot_id: evidence_snapshot_id,
    };
  },
);
