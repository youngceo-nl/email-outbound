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
  qualification_outcome: CommercialDecision["decision"] | null;
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
  supabase?: SupabaseClient;
}): Promise<{ id: string }> {
  const sb = client(opts.supabase);
  const { snapshot, leadId } = opts;
  const { data, error } = await sb
    .from("lead_evidence_snapshots")
    .insert({
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
  extraction: ExtractionResult;
  supabase?: SupabaseClient;
}): Promise<{ id: string }> {
  const sb = client(opts.supabase);
  const { extraction } = opts;
  const { data, error } = await sb
    .from("lead_commercial_extractions")
    .insert({
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
  decision: CommercialDecision;
  supabase?: SupabaseClient;
}): Promise<{ id: string }> {
  const sb = client(opts.supabase);
  const { decision } = opts;
  const { data, error } = await sb
    .from("lead_qualification_decisions")
    .insert({
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
