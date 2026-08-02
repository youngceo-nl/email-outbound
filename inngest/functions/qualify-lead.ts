import { inngest } from "@/inngest/client";
import { getSettings } from "@/lib/config/settings";
import { logCrawl, logError } from "@/lib/pipeline/persist";
import { createLlmClient } from "@/lib/qualification/providers";
import { advanceRunLead, saveQualificationRun } from "@/lib/qualification/repository";
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
    concurrency: [{ limit: 4, key: "event.data.crawl_job_id" }, { limit: 5 }],
  },
  { event: "lead/qualification.requested" },
  async ({ event, step }) => {
    const { lead_id, evidence_snapshot_id, crawl_job_id = null, run_id = null } = event.data;
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

    await step.run("log-qualification-started", () =>
      logCrawl({
        crawl_job_id,
        profile_username: snapshot.username,
        parent_username: null,
        action: "qualification_started",
        depth: 0,
        detail: `snapshot=${evidence_snapshot_id}`,
      }),
    );

    await advanceRunLead({ runId: run_id, username: snapshot.username, stage: "extracting" });

    let result: Awaited<ReturnType<typeof runCommercialQualification>>;
    try {
      result = await step.run("run-commercial-qualification", () =>
        runCommercialQualification({
          instagram: snapshot.instagram,
          precollectedSnapshot: snapshot,
          leadId: lead_id,
          llm: createLlmClient({ provider: "anthropic", model: EXTRACTOR_MODEL, apiKey }),
          challengerLlm: createLlmClient({ provider: "anthropic", model: CHALLENGER_MODEL, apiKey }),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.run("log-qualification-error", () =>
        logError({
          context: "canonical-qualification",
          error_message: message,
          payload: { lead_id, evidence_snapshot_id, username: snapshot.username },
          crawl_job_id,
        }),
      );
      // Recorded before the re-throw so a lead that burns all its retries is
      // still attributable to the extraction slot rather than vanishing.
      await advanceRunLead({
        runId: run_id,
        username: snapshot.username,
        stage: "extracting",
        patch: { status: "persist_failed", error_message: message },
      });
      throw error;
    }

    await advanceRunLead({
      runId: run_id,
      username: snapshot.username,
      stage: result.challenger?.ran ? "challenger" : "deciding",
    });

    const persisted = await step.run("persist-qualification", () =>
      saveQualificationRun({
        leadId: lead_id,
        existingSnapshotId: evidence_snapshot_id,
        snapshot,
        extraction: result.extraction,
        decision: result.decision,
        runId: run_id,
      }),
    );

    await advanceRunLead({
      runId: run_id,
      username: snapshot.username,
      stage: "done",
      patch: {
        status: "ok",
        decision: result.decision.decision,
        mode: result.decision.mode,
        track: result.decision.track,
        certainty: result.decision.certainty,
        commercial_fit: result.decision.scores?.commercial_fit ?? null,
        extraction_ok: result.extraction?.ok ?? null,
        extraction_model: result.extraction?.model ?? null,
        extraction_input_tokens: result.extraction?.usage.inputTokens ?? null,
        extraction_output_tokens: result.extraction?.usage.outputTokens ?? null,
        extraction_failure_reason:
          result.extraction && !result.extraction.ok ? result.extraction.reason : null,
        extraction_problems:
          result.extraction && !result.extraction.ok ? result.extraction.problems : null,
        challenger_trigger: result.challenger_trigger,
        challenger_ran: result.challenger?.ran ?? null,
        challenger_agrees: result.challenger?.agrees ?? null,
        challenger_model: result.challenger?.model ?? null,
        challenger_input_tokens: result.challenger?.usage.inputTokens ?? null,
        challenger_output_tokens: result.challenger?.usage.outputTokens ?? null,
        acquisition_ms: result.timings_ms.acquisition,
        extraction_ms: result.timings_ms.extraction,
        challenger_ms: result.timings_ms.challenger,
        total_ms: result.timings_ms.total,
        extraction_id: persisted.extractionId,
        decision_id: persisted.decisionId,
      },
    });

    await step.run("log-qualification-result", () =>
      logCrawl({
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
      }),
    );

    return {
      status: result.decision.decision,
      score: result.decision.scores.commercial_fit,
      certainty: result.decision.certainty,
      snapshot_id: evidence_snapshot_id,
    };
  },
);
