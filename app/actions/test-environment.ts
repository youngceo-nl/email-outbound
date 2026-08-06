"use server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";
import { getSettings, resolveApifyTokens, resolveScrapingBeeKeys } from "@/lib/config/settings";
import { buildAcquisitionPool } from "@/lib/instagram/cookie-pool";
import { scrapeFollowingDetailedWithFallback } from "@/lib/pipeline/scrape-following";
import { usernameFromInstagramUrl } from "@/lib/evidence/instagram";
import { createQualificationRun, createRunLead } from "@/lib/qualification/repository";
import {
  computeSlots,
  deriveRunTotals,
  type RunTotals,
  type RunTotalsLead,
  type Slot,
  type SlotLeadRecord,
} from "@/lib/qualification/pipeline-stages";
import { estimateCostUsd } from "@/lib/qualification/pricing";
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
import type { AppSettings } from "@/lib/types";
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

/** A run row with its counters recomputed from the lead rows. */
export type QualificationRunRowWithTotals = QualificationRunRow & { totals: RunTotals };

const TOTALS_COLUMNS =
  "stage, status, decision, extraction_ok, challenger_ran, extraction_model, challenger_model, " +
  "extraction_input_tokens, extraction_output_tokens, challenger_input_tokens, challenger_output_tokens, total_ms";

/** Recomputes a run's counters and cost from its leads. */
function applyTotals(run: QualificationRunRow, leads: RunTotalsLead[]): QualificationRunRowWithTotals {
  const totals = deriveRunTotals(leads, run.requested_count);
  const cost = estimateCostUsd([
    {
      model: totals.extractorModel ?? run.extractor_model,
      inputTokens: totals.extractionInputTokens,
      outputTokens: totals.extractionOutputTokens,
    },
    {
      model: totals.challengerModel ?? run.challenger_model,
      inputTokens: totals.challengerInputTokens,
      outputTokens: totals.challengerOutputTokens,
    },
  ]);
  return {
    ...run,
    totals,
    status: run.status === "running" && totals.complete ? "completed" : run.status,
    processed_count: totals.processed,
    qualified_count: totals.qualified,
    review_count: totals.review,
    rejected_count: totals.rejected,
    data_retry_count: totals.dataRetry,
    challenger_ran_count: totals.challengerRan,
    extraction_input_tokens: totals.extractionInputTokens,
    extraction_output_tokens: totals.extractionOutputTokens,
    challenger_input_tokens: totals.challengerInputTokens,
    challenger_output_tokens: totals.challengerOutputTokens,
    estimated_cost_usd: cost.usd,
    extractor_model: totals.extractorModel ?? run.extractor_model,
    challenger_model: totals.challengerModel ?? run.challenger_model,
  };
}

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

export async function listQualificationRuns(limit = 30): Promise<QualificationRunRowWithTotals[]> {
  await requireUser();
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("qualification_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listQualificationRuns failed: ${error.message}`);
  const runs = (data ?? []) as QualificationRunRow[];
  if (runs.length === 0) return [];

  // One query for every run's leads, grouped in memory — the run counters
  // themselves are never written, so they cannot be trusted for the list either.
  const { data: leadRows } = await sb
    .from("qualification_run_leads")
    .select(`run_id, ${TOTALS_COLUMNS}`)
    .in("run_id", runs.map((r) => r.id));

  const byRun = new Map<string, RunTotalsLead[]>();
  for (const row of (leadRows ?? []) as unknown as (RunTotalsLead & { run_id: string })[]) {
    const list = byRun.get(row.run_id);
    if (list) list.push(row);
    else byRun.set(row.run_id, [row]);
  }
  return runs.map((run) => applyTotals(run, byRun.get(run.id) ?? []));
}

export async function getQualificationRun(id: string): Promise<QualificationRunRowWithTotals | null> {
  await requireUser();
  const sb = createAdminClient();
  const { data, error } = await sb.from("qualification_runs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getQualificationRun failed: ${error.message}`);
  if (!data) return null;
  const { data: leads } = await sb
    .from("qualification_run_leads")
    .select(TOTALS_COLUMNS)
    .eq("run_id", id)
    .limit(2000);
  return applyTotals(data as QualificationRunRow, (leads ?? []) as unknown as RunTotalsLead[]);
}

export type RunLeadFilter =
  | "all"
  | "failed"
  | "skipped"
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
    /*
     * Anything the system got wrong: a thrown acquisition, a failed extraction,
     * or a persistence error. Deliberate rejects are not failures — and neither
     * are pre-filter skips or leads still in flight, all three of which the old
     * `status.neq.ok` matched.
     */
    query = query.or("status.in.(acquisition_failed,persist_failed),extraction_ok.is.false");
  } else if (filter === "skipped") {
    query = query.eq("status", "skipped");
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

  const steelBaseUrl = settings?.steel_base_url || process.env.STEEL_BASE_URL || null;
  /*
   * A self-hosted Steel behind Cloudflare Access answers 403 to everything, and
   * "the key is set" says nothing about reachability — the failure would
   * otherwise only surface as every lead in the run failing. Probed live with a
   * short timeout; any probe failure degrades to "unknown" rather than a false
   * red, since a slow network is not the same as a broken deployment.
   */
  let steelUnreachable: string | null = null;
  if (steelBaseUrl) {
    const cfId = settings?.steel_cf_client_id?.trim();
    const cfSecret = settings?.steel_cf_client_secret?.trim();
    try {
      const res = await fetch(`${steelBaseUrl.replace(/\/$/, "")}/v1/sessions?limit=1`, {
        headers:
          cfId && cfSecret
            ? { "CF-Access-Client-Id": cfId, "CF-Access-Client-Secret": cfSecret }
            : {},
        signal: AbortSignal.timeout(6000),
      });
      if (res.status === 403) {
        steelUnreachable = cfId
          ? "Cloudflare Access rejected the service token (403)"
          : "blocked by Cloudflare Access (403) — a service token is needed";
      } else if (!res.ok) {
        steelUnreachable = `HTTP ${res.status}`;
      }
    } catch {
      // Unknown, not broken.
    }
  }
  // Self-hosted needs no key at all — the container accepts anything.
  const steelKey = !!(steelBaseUrl || settings?.steel_api_key || process.env.STEEL_API_KEY);
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

  /*
   * Ordered to match the order a lead actually consumes them, which is the
   * SLOTS sequence in lib/qualification/pipeline-stages.ts:
   *
   *   prefilter          -> Apify
   *   acquiring          -> identity picked, then Steel opens the session
   *   external_evidence  -> ScrapingBee
   *   youtube            -> YouTube API
   *   extracting         -> Anthropic (Haiku), then challenger (Opus)
   *
   * Worth keeping in sync: read top-to-bottom this is also the order things
   * fail in, so the first red row is the earliest stage that breaks.
   */
  return [
    await apifyCheck(settings),
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
      label: "Steel",
      ok: steelKey && !steelUnreachable,
      blocking: true,
      detail: steelUnreachable
        ? `self-hosted at ${steelBaseUrl} is unreachable — ${steelUnreachable}`
        : steelBaseUrl
        ? `self-hosted at ${steelBaseUrl}${settings?.steel_base_url ? " (shared with the team)" : " — only on this machine, teammates will fail"}`
        : steelKey
          ? settings?.steel_api_key
            ? "Steel Cloud — set in app_settings (shared with the team)"
            : "Steel Cloud — set from STEEL_API_KEY, only on this machine, teammates will fail"
          : "not set — every acquisition fails instantly",
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
    {
      label: "Anthropic API key",
      ok: anthropicKey,
      blocking: true,
      detail: anthropicKey ? "set" : "no key — extraction fails and every lead scores zero",
    },
  ];
}

/*
 * Apify is not used by qualification at all — it sources fresh leads on the
 * seeds page. It earns a slot here because a run that starts with "get me fresh
 * leads" dies there first, and a token that is configured but over its monthly
 * limit looks identical to a working one until it 403s.
 *
 * Balance is fetched live and every failure degrades to "unknown" rather than
 * blocking the page: this is advisory, and a preflight that hangs on a third
 * party is worse than one that admits it does not know.
 */
async function apifyCheck(settings: AppSettings | null): Promise<PreflightCheck> {
  const tokens = settings ? resolveApifyTokens(settings) : [];
  const base = { label: "Apify (fresh leads only)", blocking: false };
  if (tokens.length === 0) {
    return { ...base, ok: false, detail: "no token — sourcing fresh leads will fail" };
  }

  const usable: string[] = [];
  const summaries: string[] = [];
  await Promise.all(
    tokens.map(async (token, i) => {
      try {
        const res = await fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { data } = (await res.json()) as {
          data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number } };
        };
        const used = data?.current?.monthlyUsageUsd ?? 0;
        const max = data?.limits?.maxMonthlyUsageUsd ?? 0;
        const left = max - used;
        if (left > 0.01) usable.push(token);
        summaries[i] = `#${i + 1} $${left.toFixed(2)} left`;
      } catch {
        // Unknown, not empty — never report a token as exhausted on a network blip.
        usable.push(token);
        summaries[i] = `#${i + 1} balance unknown`;
      }
    }),
  );

  return {
    ...base,
    ok: usable.length > 0,
    detail:
      usable.length > 0
        ? `${usable.length}/${tokens.length} token(s) with credit — ${summaries.filter(Boolean).join(", ")}`
        : `all ${tokens.length} token(s) over their monthly limit — ${summaries.filter(Boolean).join(", ")}`,
  };
}

// ---------------------------------------------------------------------------
// Starting a run
// ---------------------------------------------------------------------------

export type StartRunResult = { ok: true; runId: string; queued: number } | { ok: false; error: string };

/**
 * Creates the run, writes a queued row per username BEFORE emitting anything,
 * then hands the whole list to the pre-filter, which fans out to acquisition.
 * Writing the rows first is what makes "enqueued but never picked up" visible —
 * the state that is invisible today.
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

  const run = await createRunFor(usernames.length, input.label);

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

  await inngest.send({
    name: "run/prefilter.requested",
    data: { run_id: run.id, leads },
  });

  return { ok: true, runId: run.id, queued: leads.length };
}

async function createRunFor(requested: number, label: string) {
  return createQualificationRun({
    run: {
      label: label.trim() || null,
      source: "inngest",
      requested_count: requested,
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
}

export type SeedOption = { id: string; username: string; following_count: number | null };

export async function listSeeds(): Promise<SeedOption[]> {
  await requireUser();
  const sb = createAdminClient();
  const { data } = await sb
    .from("seeds")
    .select("id, username, following_count")
    .order("created_at", { ascending: false });
  return (data ?? []) as SeedOption[];
}

/**
 * Sources fresh leads off a seed's following list, then starts a run over the
 * first `limit` of them.
 *
 * Sourcing is deliberately part of the run rather than a separate step: "we
 * scraped 400 and only 3 were new" is exactly the kind of thing that is
 * invisible today, and it is reported back as `sourced`/`inserted` rather than
 * folded into the queued count.
 */
export async function startSourcedTestRun(input: {
  label: string;
  seedUsername: string;
  limit: number;
}): Promise<StartRunResult & { sourced?: number; inserted?: number }> {
  await requireUser();
  const settings = await getSettings(true);
  const apifyToken = resolveApifyTokens(settings);
  if (apifyToken.length === 0) return { ok: false, error: "No Apify token configured." };

  const limit = Math.max(1, Math.min(500, input.limit));

  let discovered;
  try {
    const result = await scrapeFollowingDetailedWithFallback({
      username: input.seedUsername.replace(/^@/, ""),
      settings,
      apifyToken,
      limitOverride: limit * 3, // over-fetch: most of a following list is already known
    });
    discovered = result.items;
  } catch (err) {
    return { ok: false, error: `sourcing failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (discovered.length === 0) return { ok: false, error: "Sourcing returned no accounts." };

  const sb = createAdminClient();
  const usernames = [...new Set(discovered.map((d) => d.username.toLowerCase()))];

  // Insert every discovery so the leads table keeps the full harvest, but only
  // run the requested slice — a 400-account seed must not silently become a
  // 400-lead Steel run at 27s each.
  const { data: existing } = await sb.from("leads").select("username").in("username", usernames.slice(0, 1000));
  const known = new Set((existing ?? []).map((l) => (l.username as string).toLowerCase()));
  const fresh = usernames.filter((u) => !known.has(u));

  if (fresh.length > 0) {
    await sb.from("leads").upsert(
      fresh.map((username) => ({
        username,
        profile_url: `https://www.instagram.com/${username}/`,
        lead_source: `test_environment:${input.seedUsername}`,
        status: "pending" as const,
      })),
      { onConflict: "username", ignoreDuplicates: true },
    );
  }

  // Prefer never-qualified leads: re-running an already-scored profile tells us
  // nothing about the pipeline.
  const { data: candidates } = await sb
    .from("leads")
    .select("id, username")
    .in("username", usernames.slice(0, 1000))
    .is("qualification_state", null)
    .limit(limit);

  const chosen = (candidates ?? []) as { id: string; username: string }[];
  if (chosen.length === 0) {
    return { ok: false, error: `Sourced ${usernames.length} accounts but none were unqualified.` };
  }

  const run = await createRunFor(chosen.length, input.label);
  for (const lead of chosen) {
    await createRunLead({
      runId: run.id,
      username: lead.username,
      status: "queued",
      fields: { lead_id: lead.id, stage: "queued", stage_entered_at: new Date().toISOString() },
    }).catch(() => {});
  }
  await inngest.send({
    name: "run/prefilter.requested",
    data: { run_id: run.id, leads: chosen.map((l) => ({ id: l.id, username: l.username })) },
  });

  return {
    ok: true,
    runId: run.id,
    queued: chosen.length,
    sourced: usernames.length,
    inserted: fresh.length,
  };
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
