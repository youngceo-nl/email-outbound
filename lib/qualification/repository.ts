/*
 * Persistence for the evidence-first qualification pipeline (gap 2 /
 * Task 2 of docs/superpowers/plans/2026-07-31-commercial-lead-qualification-implementation.md).
 *
 * lead_evidence_snapshots, lead_commercial_extractions, and
 * lead_qualification_decisions are append-only history — every call inserts
 * a new row, never updates one, so a decision can always be replayed against
 * exactly the evidence that produced it. Only `leads`'s own projection
 * columns (setLeadQualificationProjection) are ever updated in place.
 *
 * No `server-only` import — this must stay runnable under `tsx` for
 * scripts/qualify-profiles.ts and tests, same rationale as lib/evidence/http.ts.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Scorecard } from "./scorecard";
import type { CommercialDecision, EvidenceSnapshot } from "./types";
import type { ExtractionResult } from "./extract";

type SupabaseClient = ReturnType<typeof createAdminClient>;

export type QualificationState = "pending" | "processing" | "done" | "error";
export type ApprovalSource = "automatic" | "manual";

export type LeadQualificationProjection = {
  qualification_state: QualificationState;
  /*
   * The PDF's literal tier (QUALIFIED_HIGH_PRIORITY/QUALIFIED/MANUAL_REVIEW/
   * REJECTED) on decisions made from this scorecard version onward; falls
   * back to the older decision.decision string only for decisions that
   * predate `qualification` — see projectQualificationToLead.
   */
  qualification_outcome: string | null;
  qualification_decision_id: string | null;
  qualification_ready_at: string | null;
  qualification_review_reason: string | null;
  qualification_pipeline_version: string | null;
  approval_source: ApprovalSource | null;
};

export type QualificationBundle = {
  snapshot: EvidenceSnapshot;
  snapshot_row_id: string;
  extraction: ExtractionResult | null;
  extraction_row_id: string | null;
  decision: CommercialDecision;
  decision_row_id: string;
};

function client(supabase?: SupabaseClient): SupabaseClient {
  return supabase ?? createAdminClient();
}

/** Inserts a new immutable evidence snapshot row. Never updates an existing one. */
export async function createEvidenceSnapshot(opts: {
  snapshot: EvidenceSnapshot;
  leadId?: string | null;
  runId?: string | null;
  supabase?: SupabaseClient;
}): Promise<{ id: string }> {
  const sb = client(opts.supabase);
  const { snapshot, leadId } = opts;
  const { data, error } = await sb
    .from("lead_evidence_snapshots")
    .insert({
      run_id: opts.runId ?? null,
      lead_id: leadId ?? snapshot.lead_id ?? null,
      username: snapshot.username,
      captured_at: snapshot.captured_at,
      acquisition_stop_reason: snapshot.acquisition_stop_reason,
      acquisition_sufficiency: snapshot.acquisition_sufficiency,
      acquisition_version: snapshot.versions?.acquisition_version ?? null,
      payload: snapshot,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createEvidenceSnapshot failed: ${error.message}`);
  return { id: data.id as string };
}

/** Inserts a new immutable extraction row (success or failure variant). */
export async function createExtraction(opts: {
  evidenceSnapshotId: string;
  leadId?: string | null;
  runId?: string | null;
  extraction: ExtractionResult;
  supabase?: SupabaseClient;
}): Promise<{ id: string }> {
  const sb = client(opts.supabase);
  const { extraction } = opts;
  const { data, error } = await sb
    .from("lead_commercial_extractions")
    .insert({
      run_id: opts.runId ?? null,
      evidence_snapshot_id: opts.evidenceSnapshotId,
      lead_id: opts.leadId ?? null,
      extraction_prompt_version: extraction.ok ? extraction.extraction.extraction_prompt_version : null,
      provider: extraction.provider,
      model: extraction.model,
      ok: extraction.ok,
      input_tokens: extraction.usage.inputTokens,
      output_tokens: extraction.usage.outputTokens,
      payload: extraction,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createExtraction failed: ${error.message}`);
  return { id: data.id as string };
}

/** Inserts a new immutable decision row. This is the row a lead's projection points at. */
export async function createDecision(opts: {
  evidenceSnapshotId: string;
  extractionId?: string | null;
  leadId?: string | null;
  runId?: string | null;
  decision: CommercialDecision;
  supabase?: SupabaseClient;
}): Promise<{ id: string }> {
  const sb = client(opts.supabase);
  const { decision } = opts;
  const { data, error } = await sb
    .from("lead_qualification_decisions")
    .insert({
      run_id: opts.runId ?? null,
      lead_id: opts.leadId ?? null,
      evidence_snapshot_id: opts.evidenceSnapshotId,
      extraction_id: opts.extractionId ?? null,
      scorecard_version: decision.scorecard_version,
      pipeline_version: decision.versions?.pipeline_version ?? null,
      track: decision.track,
      icp_eligible: decision.icp_eligible,
      hard_exclusion: decision.hard_exclusion,
      rejection_reason: decision.rejection_reason,
      commercial_fit: decision.scores?.commercial_fit ?? null,
      qualification: decision.qualification ?? null,
      total_icp_score: decision.icp_scores?.total_icp_score ?? null,
      certainty: decision.certainty,
      challenger_agreement: decision.challenger_agreement,
      decision: decision.decision,
      mode: decision.mode,
      automatic_approval_eligible: decision.automatic_approval_eligible,
      decision_reasons: decision.decision_reasons,
      review_flags: decision.review_flags,
      priority_score: decision.priority?.value ?? null,
      payload: decision,
      decided_at: decision.decided_at,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createDecision failed: ${error.message}`);
  return { id: data.id as string };
}

/**
 * The full evidence/extraction/decision bundle behind a lead's current
 * projection — one round trip via the FK chain, newest decision first.
 */
export async function getLatestQualificationBundle(opts: {
  leadId: string;
  supabase?: SupabaseClient;
}): Promise<QualificationBundle | null> {
  const sb = client(opts.supabase);
  const { data: decisionRow, error: decisionErr } = await sb
    .from("lead_qualification_decisions")
    .select("*")
    .eq("lead_id", opts.leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (decisionErr) throw new Error(`getLatestQualificationBundle failed: ${decisionErr.message}`);
  if (!decisionRow) return null;

  const { data: snapshotRow, error: snapshotErr } = await sb
    .from("lead_evidence_snapshots")
    .select("id, payload")
    .eq("id", decisionRow.evidence_snapshot_id)
    .single();
  if (snapshotErr) throw new Error(`getLatestQualificationBundle snapshot lookup failed: ${snapshotErr.message}`);

  let extraction: ExtractionResult | null = null;
  let extractionRowId: string | null = null;
  if (decisionRow.extraction_id) {
    const { data: extractionRow, error: extractionErr } = await sb
      .from("lead_commercial_extractions")
      .select("id, payload")
      .eq("id", decisionRow.extraction_id)
      .single();
    if (extractionErr) throw new Error(`getLatestQualificationBundle extraction lookup failed: ${extractionErr.message}`);
    extraction = extractionRow.payload as ExtractionResult;
    extractionRowId = extractionRow.id as string;
  }

  return {
    snapshot: snapshotRow.payload as EvidenceSnapshot,
    snapshot_row_id: snapshotRow.id as string,
    extraction,
    extraction_row_id: extractionRowId,
    decision: decisionRow.payload as CommercialDecision,
    decision_row_id: decisionRow.id as string,
  };
}

/** The single active scorecard config row, or null when none has been activated yet. */
export async function getActiveQualificationConfig(opts?: {
  supabase?: SupabaseClient;
}): Promise<{ version: string; scorecard: Scorecard } | null> {
  const sb = client(opts?.supabase);
  const { data, error } = await sb
    .from("lead_qualification_configs")
    .select("version, scorecard")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(`getActiveQualificationConfig failed: ${error.message}`);
  if (!data) return null;
  return { version: data.version as string, scorecard: data.scorecard as Scorecard };
}

/**
 * Updates only the lead's qualification projection columns — the one
 * mutable surface in this module. Does not touch legacy score/review columns.
 */
export async function setLeadQualificationProjection(opts: {
  leadId: string;
  projection: LeadQualificationProjection;
  supabase?: SupabaseClient;
}): Promise<void> {
  const sb = client(opts.supabase);
  const { error } = await sb.from("leads").update(opts.projection).eq("id", opts.leadId);
  if (error) throw new Error(`setLeadQualificationProjection failed: ${error.message}`);
}

export type OperationalLeadStatus = "qualified" | "review" | "rejected" | "pending";

export function operationalStatusForDecision(
  decision: CommercialDecision["decision"],
): OperationalLeadStatus {
  return decision === "data_retry" ? "pending" : decision;
}

type SaveSnapshotOperation = (opts: {
  snapshot: EvidenceSnapshot;
  leadId: string;
  runId?: string | null;
}) => Promise<{ id: string }>;
type SaveExtractionOperation = (opts: {
  evidenceSnapshotId: string;
  leadId: string;
  runId?: string | null;
  extraction: ExtractionResult;
}) => Promise<{ id: string }>;
type SaveDecisionOperation = (opts: {
  evidenceSnapshotId: string;
  extractionId: string | null;
  leadId: string;
  runId?: string | null;
  decision: CommercialDecision;
}) => Promise<{ id: string }>;
type ProjectLeadOperation = (opts: {
  leadId: string;
  decisionId: string;
  decision: CommercialDecision;
}) => Promise<void>;

export type QualificationPersistenceOperations = {
  saveSnapshot: SaveSnapshotOperation;
  saveExtraction: SaveExtractionOperation;
  saveDecision: SaveDecisionOperation;
  projectLead: ProjectLeadOperation;
};

async function projectQualificationToLead(opts: {
  leadId: string;
  decisionId: string;
  decision: CommercialDecision;
  supabase?: SupabaseClient;
}): Promise<void> {
  const sb = client(opts.supabase);
  const { decision } = opts;
  const { error } = await sb
    .from("leads")
    .update({
      status: operationalStatusForDecision(decision.decision),
      qualification_state: "done",
      qualification_outcome: decision.qualification ?? decision.decision,
      qualification_decision_id: opts.decisionId,
      qualification_ready_at: decision.decided_at,
      qualification_review_reason:
        decision.mode === "manual_review" ? decision.decision_reasons.join(", ") : null,
      qualification_pipeline_version: decision.versions?.pipeline_version ?? null,
      approval_source: decision.automatic_approval_eligible ? "automatic" : null,
      rejection_reason: decision.decision === "rejected" ? decision.rejection_reason : null,
    })
    .eq("id", opts.leadId);
  if (error) throw new Error(`projectQualificationToLead failed: ${error.message}`);
}

function defaultOperations(supabase?: SupabaseClient): QualificationPersistenceOperations {
  return {
    saveSnapshot: (opts) => createEvidenceSnapshot({ ...opts, supabase }),
    saveExtraction: (opts) => createExtraction({ ...opts, supabase }),
    saveDecision: (opts) => createDecision({ ...opts, supabase }),
    projectLead: (opts) => projectQualificationToLead({ ...opts, supabase }),
  };
}

/**
 * Persists an entire run in dependency order. The mutable lead projection is
 * deliberately last, so it can never point at partial or missing history.
 */
export async function saveQualificationRun(opts: {
  leadId: string;
  existingSnapshotId?: string;
  snapshot: EvidenceSnapshot;
  extraction: ExtractionResult | null;
  decision: CommercialDecision;
  runId?: string | null;
  supabase?: SupabaseClient;
  operations?: QualificationPersistenceOperations;
}): Promise<{ snapshotId: string; extractionId: string | null; decisionId: string }> {
  const operations = opts.operations ?? defaultOperations(opts.supabase);
  const snapshot = opts.existingSnapshotId
    ? { id: opts.existingSnapshotId }
    : await operations.saveSnapshot({
        snapshot: opts.snapshot,
        leadId: opts.leadId,
        runId: opts.runId,
      });
  const extraction = opts.extraction
    ? await operations.saveExtraction({
        evidenceSnapshotId: snapshot.id,
        leadId: opts.leadId,
        runId: opts.runId,
        extraction: opts.extraction,
      })
    : null;
  const decision = await operations.saveDecision({
    evidenceSnapshotId: snapshot.id,
    extractionId: extraction?.id ?? null,
    leadId: opts.leadId,
    runId: opts.runId,
    decision: opts.decision,
  });
  await operations.projectLead({
    leadId: opts.leadId,
    decisionId: decision.id,
    decision: opts.decision,
  });
  return {
    snapshotId: snapshot.id,
    extractionId: extraction?.id ?? null,
    decisionId: decision.id,
  };
}

// ---------------------------------------------------------------------------
// Run forensics (docs/superpowers — test environment)
//
// A run row groups one CLI invocation; a run-lead row records what happened to
// each lead attempt. Unlike the three history tables above, a run-lead row is
// written even when nothing else is — a lead that terminates before the AI call
// (universal exclusion, unscrapeable profile) produces no snapshot, and used to
// leave no trace at all.
//
// `updateQualificationRun` is the second permitted in-place update in this
// module, alongside the lead projection. Run counters are a live tally, not
// immutable history.
// ---------------------------------------------------------------------------

export type QualificationRunInsert = {
  label?: string | null;
  source?: "cli" | "replay" | "inngest";
  requested_count?: number;
  concurrency?: number | null;
  extractor_provider?: string | null;
  extractor_model?: string | null;
  challenger_provider?: string | null;
  challenger_model?: string | null;
  acquisition_version?: string | null;
  extraction_prompt_version?: string | null;
  challenger_prompt_version?: string | null;
  scorecard_version?: string | null;
  config_version?: string | null;
  pipeline_version?: string | null;
  notes?: string | null;
};

export async function createQualificationRun(opts: {
  run: QualificationRunInsert;
  supabase?: SupabaseClient;
}): Promise<{ id: string }> {
  const sb = client(opts.supabase);
  const { data, error } = await sb
    .from("qualification_runs")
    .insert({ source: "cli", ...opts.run })
    .select("id")
    .single();
  if (error) throw new Error(`createQualificationRun failed: ${error.message}`);
  return { id: data.id as string };
}

export async function updateQualificationRun(opts: {
  runId: string;
  patch: Record<string, unknown>;
  supabase?: SupabaseClient;
}): Promise<void> {
  const sb = client(opts.supabase);
  const { error } = await sb.from("qualification_runs").update(opts.patch).eq("id", opts.runId);
  if (error) throw new Error(`updateQualificationRun failed: ${error.message}`);
}

export type RunLeadStatus =
  | "queued"
  | "running"
  | "ok"
  | "acquisition_failed"
  | "persist_failed"
  | "skipped";

/**
 * Records one lead attempt. Always called, including on the paths that write no
 * snapshot — that is the whole point of the table.
 */
export async function createRunLead(opts: {
  runId: string;
  username: string;
  status: RunLeadStatus;
  fields?: Record<string, unknown>;
  supabase?: SupabaseClient;
}): Promise<{ id: string }> {
  const sb = client(opts.supabase);
  const { data, error } = await sb
    .from("qualification_run_leads")
    .insert({
      run_id: opts.runId,
      username: opts.username,
      status: opts.status,
      ...opts.fields,
    })
    .select("id")
    .single();
  if (error) throw new Error(`createRunLead failed: ${error.message}`);
  return { id: data.id as string };
}

/**
 * Advances a lead to a new slot. Unlike the history tables, a run-lead row is
 * live state — this is the third and last permitted in-place update in this
 * module, alongside the lead projection and the run counters.
 *
 * Keyed on the unique (run_id, username) index. Never throws: losing a progress
 * marker must not fail the pipeline step that was actually doing the work.
 */
/**
 * Advances many leads of one run to the same slot in a single statement.
 *
 * The pre-filter drops a third of a run at once, and doing that one round-trip
 * at a time would add minutes to a 500-lead run for nothing. Chunked so a few
 * hundred usernames cannot push the PostgREST URL past its length limit.
 */
export async function advanceRunLeads(opts: {
  runId: string | null | undefined;
  usernames: readonly string[];
  stage: string;
  patch?: Record<string, unknown>;
  supabase?: SupabaseClient;
}): Promise<void> {
  if (!opts.runId || opts.usernames.length === 0) return;
  const sb = client(opts.supabase);
  const names = opts.usernames.map((u) => u.toLowerCase());

  for (let i = 0; i < names.length; i += 100) {
    const { error } = await sb
      .from("qualification_run_leads")
      .update({
        stage: opts.stage,
        stage_entered_at: new Date().toISOString(),
        ...opts.patch,
      })
      .eq("run_id", opts.runId)
      .in("username", names.slice(i, i + 100));
    if (error) {
      console.warn(`advanceRunLeads(→ ${opts.stage}) failed: ${error.message}`);
    }
  }
}

export async function advanceRunLead(opts: {
  runId: string | null | undefined;
  username: string;
  stage: string;
  patch?: Record<string, unknown>;
  supabase?: SupabaseClient;
}): Promise<void> {
  if (!opts.runId) return;
  const sb = client(opts.supabase);
  const { error } = await sb
    .from("qualification_run_leads")
    .update({
      stage: opts.stage,
      stage_entered_at: new Date().toISOString(),
      ...opts.patch,
    })
    .eq("run_id", opts.runId)
    .eq("username", opts.username.toLowerCase());
  if (error) {
    console.warn(`advanceRunLead(${opts.username} → ${opts.stage}) failed: ${error.message}`);
  }
}
