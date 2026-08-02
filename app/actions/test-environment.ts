"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { getSettings, resolveScrapingBeeKeys } from "@/lib/config/settings";
import { buildAcquisitionPool } from "@/lib/instagram/cookie-pool";
import { buildProfileAcquisitionEvents } from "@/lib/pipeline/canonical-events";
import { usernameFromInstagramUrl } from "@/lib/evidence/instagram";
import { createQualificationRun, createRunLead } from "@/lib/qualification/repository";
import {
  computeSlots,
  type Slot,
  type SlotLeadRecord,
} from "@/lib/qualification/pipeline-stages";
import {
  ACQUISITION_VERSION,
  CHALLENGER_PROMPT_VERSION,
  CONFIG_VERSION,
  EXTRACTION_PROMPT_VERSION,
  PIPELINE_VERSION,
  SCORECARD_VERSION,
} from "@/lib/evidence/versions";
import type { ExtractionResult } from "@/lib/qualification/extract";
import type { RunLeadRecord } from "@/lib/qualification/pipeline-stages";
import type { CommercialDecision, EvidenceSnapshot } from "@/lib/qualification/types";

async function requireUser() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

export type QualificationRunRow = {
  id: string;
  label: string | null;
  source: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  requested_count: number;
  processed_count: number;
  qualified_count: number;
  review_count: number;
  rejected_count: number;
  data_retry_count: number;
  acquisition_failed_count: number;
  extraction_failed_count: number;
  challenger_failed_count: number;
  persist_failed_count: number;
  challenger_ran_count: number;
  extraction_input_tokens: number;
  extraction_output_tokens: number;
  challenger_input_tokens: number;
  challenger_output_tokens: number;
  estimated_cost_usd: number | null;
  extractor_model: string | null;
  challenger_model: string | null;
  pipeline_version: string | null;
  error_message: string | null;
};

export type RunLeadRow = RunLeadRecord & {
  id: string;
  run_id: string;
  lead_id: string | null;
  username: string;
  decision: string | null;
  mode: string | null;
  track: string | null;
  certainty: string | null;
  commercial_fit: number | null;
  estimated_cost_usd: number | null;
  evidence_snapshot_id: string | null;
  extraction_id: string | null;
  decision_id: string | null;
  created_at: string;
};

export async function listQualificationRuns(limit = 30): Promise<QualificationRunRow[]> {
  await requireUser();
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("qualification_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listQualificationRuns failed: ${error.message}`);
  return (data ?? []) as QualificationRunRow[];
}

export async function getQualificationRun(id: string): Promise<QualificationRunRow | null> {
  await requireUser();
  const sb = createAdminClient();
  const { data, error } = await sb.from("qualification_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getQualificationRun failed: ${error.message}`);
  return (data as QualificationRunRow) ?? null;
}

export type RunLeadFilter =
  | "all"
  | "failed"
  | "qualified"
  | "review"
  | "rejected"
  | "data_retry";

/**
 * Scoped by run_id rather than an id list, so this never approaches the
 * PostgREST URL-length limit that a few hundred UUIDs in `.in()` would hit.
 */
export async function listRunLeads(
  runId: string,
  filter: RunLeadFilter = "all",
  limit = 1000,
): Promise<RunLeadRow[]> {
  await requireUser();
  const sb = createAdminClient();

  let query = sb
    .from("qualification_run_leads")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (filter === "failed") {
    // Anything the system got wrong: a thrown acquisition, a failed extraction,
    // or a persistence error. Deliberate rejects are not failures.
    query = query.or("status.neq.ok,extraction_ok.is.false");
  } else if (filter !== "all") {
    query = query.eq("decision", filter);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listRunLeads failed: ${error.message}`);
  return (data ?? []) as RunLeadRow[];
}

export type RunLeadTrace = {
  runLead: RunLeadRow;
  snapshot: EvidenceSnapshot | null;
  extraction: ExtractionResult | null;
  decision: CommercialDecision | null;
  profileUrl: string | null;
  bio: string | null;
};

// ---------------------------------------------------------------------------
// Preflight
//
// A run costs Steel session minutes and Anthropic tokens, and the failure modes
// are all silent: a missing STEEL_API_KEY fails every acquisition instantly, an
// empty identity pool throws before the first step even runs. Surfacing this
// before the Start button is pressed is cheaper than reading it off a wall of red.
// ---------------------------------------------------------------------------

export type PreflightCheck = {
  label: string;
  ok: boolean;
  detail: string;
  /** false when the run can proceed degraded rather than not at all. */
  blocking: boolean;
};

export async function getPreflight(): Promise<PreflightCheck[]> {
  await requireUser();
  const settings = await getSettings(true).catch(() => null);

  const steelKey = !!process.env.STEEL_API_KEY;
  // buildAcquisitionPool throws before the first step when an identity is
  // incomplete, so count defensively rather than letting the run explode.
  let identities = 0;
  let poolError: string | null = null;
  try {
    identities = settings ? buildAcquisitionPool(settings).length : 0;
  } catch (err) {
    poolError = err instanceof Error ? err.message : String(err);
  }
  const anthropicKey = !!(settings?.claude_api_key || process.env.ANTHROPIC_API_KEY);
  const scrapingBee = settings ? resolveScrapingBeeKeys(settings).length > 0 : false;
  const youtube = !!(settings?.youtube_api_key || process.env.YOUTUBE_API_KEY);

  return [
    {
      label: "Steel API key",
      ok: steelKey,
      blocking: true,
      detail: steelKey ? "set" : "no STEEL_API_KEY — every acquisition fails instantly",
    },
    {
      label: "Instagram identities",
      ok: identities > 0 && !poolError,
      blocking: true,
      detail: poolError
        ? `pool is malformed: ${poolError}`
        : identities > 0
          ? `${identities} usable cookie identity(ies)`
          : "empty pool — acquisition throws before the first step runs",
    },
    {
      label: "Anthropic API key",
      ok: anthropicKey,
      blocking: true,
      detail: anthropicKey ? "set" : "no key — extraction fails and every lead scores zero",
    },
    {
      label: "ScrapingBee key",
      ok: scrapingBee,
      blocking: false,
      detail: scrapingBee
        ? "set — JavaScript landing pages can be read"
        : "not set — JS-shell landing pages will read as empty",
    },
    {
      label: "YouTube API key",
      ok: youtube,
      blocking: false,
      detail: youtube ? "set" : "not set — falls back to rate-limited HTML scraping",
    },
  ];
}

// ---------------------------------------------------------------------------
// Starting a run
// ---------------------------------------------------------------------------

export type StartRunResult = { ok: true; runId: string; queued: number } | { ok: false; error: string };

/**
 * Creates the run, writes a queued row per username BEFORE emitting anything,
 * then fans out acquisition events. Writing the rows first is what makes
 * "enqueued but never picked up" visible — the state that is invisible today.
 */
export async function startTestRun(input: {
  label: string;
  usernames: string;
}): Promise<StartRunResult> {
  await requireUser();

  const usernames = [
    ...new Set(
      input.usernames
        .split(/[\s,]+/)
        .map((raw) => usernameFromInstagramUrl(raw.trim()))
        .filter((u): u is string => !!u)
        .map((u) => u.toLowerCase()),
    ),
  ];
  if (usernames.length === 0) return { ok: false, error: "No valid Instagram usernames found." };

  const sb = createAdminClient();

  // Every lead must exist as a row before acquisition can attach evidence to it.
  const { data: existing } = await sb.from("leads").select("id, username").in("username", usernames);
  const byUsername = new Map((existing ?? []).map((l) => [l.username as string, l.id as string]));

  const missing = usernames.filter((u) => !byUsername.has(u));
  if (missing.length > 0) {
    const { data: inserted, error } = await sb
      .from("leads")
      .upsert(
        missing.map((username) => ({
          username,
          profile_url: `https://www.instagram.com/${username}/`,
          lead_source: "test_environment",
          status: "pending" as const,
        })),
        { onConflict: "username", ignoreDuplicates: false },
      )
      .select("id, username");
    if (error) return { ok: false, error: `could not create lead rows: ${error.message}` };
    for (const row of inserted ?? []) byUsername.set(row.username as string, row.id as string);
  }

  const run = await createQualificationRun({
    run: {
      label: input.label.trim() || null,
      source: "inngest",
      requested_count: usernames.length,
      extractor_provider: "anthropic",
      extractor_model: "claude-haiku-4-5",
      challenger_provider: "anthropic",
      challenger_model: "claude-opus-5",
      acquisition_version: ACQUISITION_VERSION,
      extraction_prompt_version: EXTRACTION_PROMPT_VERSION,
      challenger_prompt_version: CHALLENGER_PROMPT_VERSION,
      scorecard_version: SCORECARD_VERSION,
      config_version: CONFIG_VERSION,
      pipeline_version: PIPELINE_VERSION,
    },
  });

  const leads = usernames
    .filter((u) => byUsername.has(u))
    .map((username) => ({ id: byUsername.get(username) as string, username }));

  for (const lead of leads) {
    await createRunLead({
      runId: run.id,
      username: lead.username,
      status: "queued",
      fields: { lead_id: lead.id, stage: "queued", stage_entered_at: new Date().toISOString() },
    }).catch(() => {});
  }

  await inngest.send(buildProfileAcquisitionEvents(leads, null, run.id));

  return { ok: true, runId: run.id, queued: leads.length };
}

export async function getRunSlots(runId: string): Promise<Slot[]> {
  await requireUser();
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("qualification_run_leads")
    .select("stage, status, stage_entered_at, extraction_ok, decision, mode")
    .eq("run_id", runId)
    .limit(2000);
  if (error) throw new Error(`getRunSlots failed: ${error.message}`);
  return computeSlots((data ?? []) as SlotLeadRecord[]);
}

export async function getRunLeadTrace(runLeadId: string): Promise<RunLeadTrace | null> {
  await requireUser();
  const sb = createAdminClient();

  const { data: runLead, error } = await sb
    .from("qualification_run_leads")
    .select("*")
    .eq("id", runLeadId)
    .maybeSingle();
  if (error) throw new Error(`getRunLeadTrace failed: ${error.message}`);
  if (!runLead) return null;

  const row = runLead as RunLeadRow;

  // Single-row lookups by primary key — no `.in()`, no URL-length risk.
  const [snapshot, extraction, decision, lead] = await Promise.all([
    row.evidence_snapshot_id
      ? sb.from("lead_evidence_snapshots").select("payload").eq("id", row.evidence_snapshot_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.extraction_id
      ? sb.from("lead_commercial_extractions").select("payload").eq("id", row.extraction_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.decision_id
      ? sb.from("lead_qualification_decisions").select("payload").eq("id", row.decision_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.lead_id
      ? sb.from("leads").select("profile_url, bio").eq("id", row.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    runLead: row,
    snapshot: (snapshot.data?.payload as EvidenceSnapshot) ?? null,
    extraction: (extraction.data?.payload as ExtractionResult) ?? null,
    decision: (decision.data?.payload as CommercialDecision) ?? null,
    profileUrl:
      (lead.data?.profile_url as string | undefined) ??
      `https://www.instagram.com/${row.username}/`,
    bio: (lead.data?.bio as string | undefined) ?? null,
  };
}
