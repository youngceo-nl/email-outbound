/*
 * Turns stored run forensics into an ordered, human-readable pipeline trace.
 *
 * The question this answers is "where did it break", which the raw rows cannot
 * answer on their own. The motivating case: on 2026-08-01 a batch wrote 552
 * decisions whose five dimension scores were all zero. Read literally that says
 * "these profiles are weak". It actually meant "the AI call never happened —
 * the credit balance ran out". Stage 6 below encodes exactly that distinction.
 *
 * Pure and dependency-free so it can be unit-tested without a database.
 */

import type { ExtractionResult } from "./extract";
import type { CommercialDecision, EvidenceSnapshot } from "./types";

export type StageState =
  | "ok"
  | "degraded"
  /** The system did not work. Always a defect worth investigating. */
  | "failed"
  /*
   * A deliberate, correct stop — a universal exclusion or the hard
   * business-model gate. Kept distinct from `failed` on purpose: colouring a
   * correctly-rejected agency red teaches people to ignore red.
   */
  | "blocked"
  | "skipped";

export type StageRow = {
  label: string;
  value: string;
  /** Renders monospace and untruncated — for provider errors and raw evidence. */
  verbatim?: boolean;
  tone?: "default" | "muted" | "bad";
};

export type Stage = {
  key: string;
  title: string;
  state: StageState;
  headline: string;
  /** False when the run predates this field being captured — renders grey, never a false green. */
  recorded: boolean;
  rows: StageRow[];
};

/** The subset of a qualification_run_leads row the trace needs. */
export type RunLeadRecord = {
  status: "ok" | "acquisition_failed" | "persist_failed" | "skipped";
  error_message: string | null;
  acquisition_source: string | null;
  profile_extraction_method: string | null;
  sufficiency_verdict: string | null;
  sufficiency_data_quality: string | null;
  sufficiency_reasons: string[] | null;
  sufficiency_exclusion_evidence: string | null;
  extraction_ok: boolean | null;
  extraction_provider: string | null;
  extraction_model: string | null;
  extraction_input_tokens: number | null;
  extraction_output_tokens: number | null;
  extraction_failure_reason: string | null;
  extraction_problems: string[] | null;
  challenger_trigger: string | null;
  challenger_ran: boolean | null;
  challenger_agrees: boolean | null;
  challenger_error: string | null;
  challenger_disagreements: string[] | null;
  challenger_model: string | null;
  challenger_input_tokens: number | null;
  challenger_output_tokens: number | null;
  acquisition_ms: number | null;
  extraction_ms: number | null;
  challenger_ms: number | null;
  total_ms: number | null;
};

const ACQUISITION_SOURCE_LABELS: Record<string, string> = {
  // Steel is the production path (inngest/functions/acquire-profile.ts); the
  // others survive only in the CLI harness.
  steel: "Steel browser",
  apify: "Apify",
  scrapingbee_web_profile_info: "ScrapingBee (web_profile_info)",
  scrapingbee_metadata: "ScrapingBee (metadata fallback)",
};

function ms(value: number | null): string {
  return value === null ? "not recorded" : `${value}ms`;
}

/** True when every scored dimension came out at zero. */
function allScoresZero(decision: CommercialDecision | null): boolean {
  const s = decision?.scores;
  if (!s) return false;
  return (
    s.buyer_clarity === 0 &&
    s.transformation_clarity === 0 &&
    s.information_funnel_evidence === 0 &&
    s.conversion_intent === 0 &&
    s.proof_maturity === 0
  );
}

export function deriveStages(input: {
  runLead: RunLeadRecord;
  snapshot: EvidenceSnapshot | null;
  extraction: ExtractionResult | null;
  decision: CommercialDecision | null;
}): Stage[] {
  const { runLead, snapshot, extraction, decision } = input;
  const stages: Stage[] = [];

  stages.push(acquisitionStage(runLead, snapshot));
  stages.push(externalStage(snapshot));
  stages.push(sufficiencyStage(runLead));
  stages.push(extractionStage(runLead, extraction));
  stages.push(trackStage(decision, extraction));
  stages.push(coreGateStage(runLead, decision));
  stages.push(certaintyStage(decision));
  stages.push(challengerStage(runLead, decision));
  stages.push(finalStage(decision));

  /*
   * Once something has failed or been deliberately stopped, later stages did
   * not run. Saying "skipped — not reached" is honest; leaving them green would
   * imply work that never happened.
   */
  let halted = false;
  return stages.map((stage) => {
    if (halted && !stage.recorded) {
      return { ...stage, state: "skipped" as StageState, headline: "Not reached" };
    }
    if (stage.state === "failed" || stage.state === "blocked") halted = true;
    return stage;
  });
}

function acquisitionStage(runLead: RunLeadRecord, snapshot: EvidenceSnapshot | null): Stage {
  const rows: StageRow[] = [];
  const ig = snapshot?.instagram;

  if (runLead.status === "acquisition_failed") {
    return {
      key: "acquisition",
      title: "1. Instagram acquisition",
      state: "failed",
      headline: "Acquisition threw before any evidence was captured",
      recorded: true,
      rows: [{ label: "Error", value: runLead.error_message ?? "unknown", verbatim: true, tone: "bad" }],
    };
  }

  if (!ig) {
    return {
      key: "acquisition",
      title: "1. Instagram acquisition",
      state: "skipped",
      headline: "No evidence snapshot was stored for this lead",
      recorded: false,
      rows: [],
    };
  }

  const source = runLead.acquisition_source ?? ig.acquisition_source ?? null;
  rows.push({
    label: "Served by",
    value: source ? (ACQUISITION_SOURCE_LABELS[source] ?? source) : "not recorded",
    tone: source ? "default" : "muted",
  });
  rows.push({ label: "Parse method", value: ig.profile_extraction_method });
  rows.push({ label: "Profile", value: ig.profile_capture_status });
  rows.push({ label: "Recent posts", value: ig.recent_posts_capture_status });
  rows.push({ label: "Pinned posts", value: ig.pinned_posts_capture_status });
  rows.push({ label: "Story highlights", value: ig.story_highlights_capture_status });
  rows.push({ label: "Bio link", value: ig.external_link_capture_status });
  rows.push({ label: "Followers", value: ig.followers?.toLocaleString() ?? "unknown" });
  rows.push({ label: "Private", value: ig.is_private ? "yes" : "no" });
  rows.push({ label: "Took", value: ms(runLead.acquisition_ms), tone: "muted" });

  if (ig.profile_capture_status !== "captured") {
    return {
      key: "acquisition",
      title: "1. Instagram acquisition",
      state: "failed",
      headline: `Profile was not captured (${ig.profile_capture_status})`,
      recorded: true,
      rows,
    };
  }

  const degradedSurfaces = [
    ["recent posts", ig.recent_posts_capture_status],
    ["pinned posts", ig.pinned_posts_capture_status],
    ["story highlights", ig.story_highlights_capture_status],
    ["bio link", ig.external_link_capture_status],
  ].filter(([, status]) => status !== "captured");

  if (ig.profile_extraction_method === "metadata_fallback") {
    return {
      key: "acquisition",
      title: "1. Instagram acquisition",
      state: "degraded",
      headline: "Served by the metadata fallback — the bio link was never visible",
      recorded: true,
      rows,
    };
  }

  if (degradedSurfaces.length > 0) {
    return {
      key: "acquisition",
      title: "1. Instagram acquisition",
      state: "degraded",
      headline: `${degradedSurfaces.length} surface(s) not captured: ${degradedSurfaces
        .map(([name]) => name)
        .join(", ")}`,
      recorded: true,
      rows,
    };
  }

  return {
    key: "acquisition",
    title: "1. Instagram acquisition",
    state: "ok",
    headline: "Profile and all surfaces captured",
    recorded: true,
    rows,
  };
}

function externalStage(snapshot: EvidenceSnapshot | null): Stage {
  if (!snapshot) {
    return {
      key: "external",
      title: "2. External evidence",
      state: "skipped",
      headline: "Not reached",
      recorded: false,
      rows: [],
    };
  }

  const destinations = snapshot.external_destinations ?? [];
  const rows: StageRow[] = [
    { label: "Capture status", value: snapshot.external_capture_status },
    { label: "Destinations inspected", value: String(destinations.length) },
    { label: "YouTube channels", value: String((snapshot.youtube_channels ?? []).length) },
    { label: "YouTube videos", value: String((snapshot.youtube_videos ?? []).length) },
    { label: "CTA hops", value: String(snapshot.hops_used ?? (snapshot.cta_chain ?? []).length) },
    { label: "Stopped because", value: snapshot.acquisition_stop_reason ?? "unknown" },
    { label: "Sufficiency", value: snapshot.acquisition_sufficiency ?? "unknown" },
  ];

  const chain = (snapshot.cta_chain ?? []).map((hop) => hop.action).filter(Boolean);
  if (chain.length > 0) rows.push({ label: "CTA chain", value: chain.join("  →  ") });

  for (const surface of snapshot.unknown_surfaces ?? []) {
    rows.push({ label: "Unknown surface", value: String(surface), tone: "muted" });
  }

  if (snapshot.external_capture_status === "not_attempted" && destinations.length === 0) {
    return {
      key: "external",
      title: "2. External evidence",
      state: "skipped",
      headline: "No external link on the profile",
      recorded: true,
      rows,
    };
  }

  if (snapshot.external_capture_status === "failed") {
    return {
      key: "external",
      title: "2. External evidence",
      state: "failed",
      headline: "External capture failed",
      recorded: true,
      rows,
    };
  }

  if (snapshot.acquisition_sufficiency === "partial") {
    return {
      key: "external",
      title: "2. External evidence",
      state: "degraded",
      headline: `Partial evidence — stopped at "${snapshot.acquisition_stop_reason}"`,
      recorded: true,
      rows,
    };
  }

  return {
    key: "external",
    title: "2. External evidence",
    state: "ok",
    headline: `${destinations.length} destination(s) inspected`,
    recorded: true,
    rows,
  };
}

function sufficiencyStage(runLead: RunLeadRecord): Stage {
  const verdict = runLead.sufficiency_verdict;
  if (!verdict) {
    return {
      key: "sufficiency",
      title: "3. Data quality & exclusions",
      state: "skipped",
      headline: "Not recorded for this run",
      recorded: false,
      rows: [],
    };
  }

  const rows: StageRow[] = [
    { label: "Verdict", value: verdict },
    { label: "Data quality", value: runLead.sufficiency_data_quality ?? "unknown" },
  ];
  for (const reason of runLead.sufficiency_reasons ?? []) {
    rows.push({ label: "Reason", value: reason });
  }
  if (runLead.sufficiency_exclusion_evidence) {
    rows.push({
      label: "Exclusion evidence",
      value: runLead.sufficiency_exclusion_evidence,
      verbatim: true,
    });
  }

  if (verdict === "excluded") {
    return {
      key: "sufficiency",
      title: "3. Data quality & exclusions",
      state: "blocked",
      headline: "Stopped by a universal exclusion — a deliberate reject, not a fault",
      recorded: true,
      rows,
    };
  }
  if (verdict === "retryable") {
    return {
      key: "sufficiency",
      title: "3. Data quality & exclusions",
      state: "failed",
      headline: "Could not see enough of the profile to judge it — needs a data retry",
      recorded: true,
      rows,
    };
  }
  if (verdict === "review_required") {
    return {
      key: "sufficiency",
      title: "3. Data quality & exclusions",
      state: "degraded",
      headline: "Enough to score, but a human should confirm",
      recorded: true,
      rows,
    };
  }

  return {
    key: "sufficiency",
    title: "3. Data quality & exclusions",
    state: "ok",
    headline: "Evidence sufficient to proceed",
    recorded: true,
    rows,
  };
}

function extractionStage(runLead: RunLeadRecord, extraction: ExtractionResult | null): Stage {
  if (runLead.extraction_ok === null && !extraction) {
    return {
      key: "extraction",
      title: "4. AI extraction",
      state: "skipped",
      headline: "Not reached — the lead terminated before the AI call",
      recorded: false,
      rows: [],
    };
  }

  const ok = runLead.extraction_ok ?? (extraction?.ok ?? null);
  const rows: StageRow[] = [
    { label: "Provider", value: runLead.extraction_provider ?? extraction?.provider ?? "unknown" },
    { label: "Model", value: runLead.extraction_model ?? extraction?.model ?? "unknown" },
    {
      label: "Tokens",
      value: `${runLead.extraction_input_tokens ?? extraction?.usage.inputTokens ?? 0} in / ${
        runLead.extraction_output_tokens ?? extraction?.usage.outputTokens ?? 0
      } out`,
    },
    { label: "Took", value: ms(runLead.extraction_ms), tone: "muted" },
  ];

  if (ok === false) {
    const reason =
      runLead.extraction_failure_reason ??
      (extraction && !extraction.ok ? extraction.reason : "unknown");
    const problems =
      runLead.extraction_problems ?? (extraction && !extraction.ok ? extraction.problems : []) ?? [];

    // Untruncated and verbatim on purpose: this is where "credit balance is too
    // low" lives, and truncating it is what made the original outage invisible.
    for (const problem of problems) {
      rows.push({ label: "Problem", value: problem, verbatim: true, tone: "bad" });
    }

    return {
      key: "extraction",
      title: "4. AI extraction",
      state: "failed",
      headline: `Extraction failed — ${reason}`,
      recorded: true,
      rows,
    };
  }

  if (extraction?.ok && (extraction.repaired || extraction.citation_warnings.length > 0)) {
    for (const warning of extraction.citation_warnings) {
      rows.push({ label: "Citation warning", value: warning, verbatim: true });
    }
    return {
      key: "extraction",
      title: "4. AI extraction",
      state: "degraded",
      headline: extraction.repaired
        ? "Model output needed repair before it validated"
        : "Validated with citation warnings",
      recorded: true,
      rows,
    };
  }

  return {
    key: "extraction",
    title: "4. AI extraction",
    state: "ok",
    headline: "Evidence extracted and validated",
    recorded: true,
    rows,
  };
}

function trackStage(decision: CommercialDecision | null, extraction: ExtractionResult | null): Stage {
  if (!decision || (extraction && !extraction.ok)) {
    return {
      key: "track",
      title: "5. Track & business-model gate",
      state: "skipped",
      headline: "Not reached",
      recorded: false,
      rows: [],
    };
  }

  const rows: StageRow[] = [
    { label: "Track", value: decision.track },
    { label: "ICP eligible", value: decision.icp_eligible ? "yes" : "no" },
    { label: "Primary visitor outcome", value: decision.primary_visitor_outcome ?? "unknown" },
  ];
  if (decision.track_reason) rows.push({ label: "Why", value: decision.track_reason, verbatim: true });
  if (decision.hard_gate_reason) {
    rows.push({ label: "Gate", value: decision.hard_gate_reason, verbatim: true });
  }

  if (decision.hard_exclusion) {
    return {
      key: "track",
      title: "5. Track & business-model gate",
      state: "blocked",
      headline: `Hard exclusion — ${decision.rejection_reason ?? "business model out of ICP"}`,
      recorded: true,
      rows,
    };
  }
  if (decision.track === "uncertain" || decision.review_flags.includes("agency_information_mixed")) {
    return {
      key: "track",
      title: "5. Track & business-model gate",
      state: "degraded",
      headline: "Business model is mixed or uncertain",
      recorded: true,
      rows,
    };
  }

  return {
    key: "track",
    title: "5. Track & business-model gate",
    state: "ok",
    headline: `Classified as ${decision.track}`,
    recorded: true,
    rows,
  };
}

function coreGateStage(runLead: RunLeadRecord, decision: CommercialDecision | null): Stage {
  if (!decision) {
    return {
      key: "core-gate",
      title: "6. Core gate & scoring",
      state: "skipped",
      headline: "Not reached",
      recorded: false,
      rows: [],
    };
  }

  const rows: StageRow[] = [];
  for (const [signal, state] of Object.entries(decision.signal_states ?? {})) {
    rows.push({ label: signal.replace(/_/g, " "), value: String(state) });
  }

  const s = decision.scores;
  if (s) {
    rows.push({ label: "buyer clarity", value: String(s.buyer_clarity) });
    rows.push({ label: "transformation clarity", value: String(s.transformation_clarity) });
    rows.push({ label: "information funnel", value: String(s.information_funnel_evidence) });
    rows.push({ label: "conversion intent", value: String(s.conversion_intent) });
    rows.push({
      label: "proof + authority",
      value: `${s.proof_maturity} (${s.proof_strength} + ${s.authority_strength})`,
    });
    rows.push({ label: "commercial fit", value: `${s.commercial_fit} / 10` });
  }

  /*
   * The single most valuable verdict on this page. All-zero scores next to a
   * failed extraction do NOT mean the profile is weak — they mean the model
   * never ran. 552 leads were written in exactly this state on 2026-08-01 and
   * read as legitimate rejections.
   */
  if (allScoresZero(decision) && runLead.extraction_ok === false) {
    return {
      key: "core-gate",
      title: "6. Core gate & scoring",
      state: "failed",
      headline: "Scores are zero because extraction failed, not because the profile is weak",
      recorded: true,
      rows,
    };
  }

  const gate = decision.core_gate;
  if (gate) {
    for (const signal of gate.unknown_signals) {
      rows.push({ label: "Unknown signal", value: signal, tone: "muted" });
    }
    for (const signal of gate.absent_signals) {
      rows.push({ label: "Absent signal", value: signal });
    }
    if (!gate.passes) {
      return {
        key: "core-gate",
        title: "6. Core gate & scoring",
        state: "degraded",
        headline: "Core gate did not pass — funnel, CTA, or a supporting signal is missing",
        recorded: true,
        rows,
      };
    }
  }

  return {
    key: "core-gate",
    title: "6. Core gate & scoring",
    state: "ok",
    headline: `Core gate passed · commercial fit ${s?.commercial_fit ?? "?"} / 10`,
    recorded: true,
    rows,
  };
}

function certaintyStage(decision: CommercialDecision | null): Stage {
  if (!decision) {
    return {
      key: "certainty",
      title: "7. Evidence certainty",
      state: "skipped",
      headline: "Not reached",
      recorded: false,
      rows: [],
    };
  }

  const rows: StageRow[] = [{ label: "Certainty", value: decision.certainty }];
  for (const blocker of decision.certainty_blockers ?? []) {
    rows.push({ label: "Blocker", value: blocker, verbatim: true });
  }
  for (const reason of decision.certainty_reasons ?? []) {
    rows.push({ label: "Satisfied", value: reason, tone: "muted" });
  }

  return {
    key: "certainty",
    title: "7. Evidence certainty",
    state: decision.certainty === "high" ? "ok" : "degraded",
    headline: `Certainty is ${decision.certainty}`,
    recorded: true,
    rows,
  };
}

function challengerStage(runLead: RunLeadRecord, decision: CommercialDecision | null): Stage {
  const trigger = runLead.challenger_trigger;
  if (!trigger) {
    return {
      key: "challenger",
      title: "8. Challenger verification",
      state: "skipped",
      headline: "Not recorded for this run",
      recorded: false,
      rows: [],
    };
  }

  const rows: StageRow[] = [
    { label: "Trigger", value: trigger },
    { label: "Model", value: runLead.challenger_model ?? "—" },
    {
      label: "Tokens",
      value:
        runLead.challenger_input_tokens === null
          ? "—"
          : `${runLead.challenger_input_tokens} in / ${runLead.challenger_output_tokens ?? 0} out`,
    },
    { label: "Took", value: ms(runLead.challenger_ms), tone: "muted" },
  ];

  if (trigger === "none") {
    // Say why it did not run — "none" alone reads like an omission.
    const why = decision?.hard_exclusion
      ? "the lead was already hard-excluded"
      : "no auto-approval was proposed and the evidence carried no conflicts";
    return {
      key: "challenger",
      title: "8. Challenger verification",
      state: "skipped",
      headline: `Not triggered — ${why}`,
      recorded: true,
      rows,
    };
  }

  if (runLead.challenger_error) {
    rows.push({ label: "Error", value: runLead.challenger_error, verbatim: true, tone: "bad" });
    return {
      key: "challenger",
      title: "8. Challenger verification",
      state: "failed",
      headline: "Challenger could not produce a verdict",
      recorded: true,
      rows,
    };
  }

  if (runLead.challenger_agrees === false) {
    for (const disagreement of runLead.challenger_disagreements ?? []) {
      rows.push({ label: "Disagreement", value: disagreement, verbatim: true });
    }
    return {
      key: "challenger",
      title: "8. Challenger verification",
      state: "degraded",
      headline: "Challenger disagreed with the extraction",
      recorded: true,
      rows,
    };
  }

  return {
    key: "challenger",
    title: "8. Challenger verification",
    state: "ok",
    headline: `Ran (${trigger}) and agreed`,
    recorded: true,
    rows,
  };
}

function finalStage(decision: CommercialDecision | null): Stage {
  if (!decision) {
    return {
      key: "decision",
      title: "9. Final decision",
      state: "skipped",
      headline: "No decision was recorded",
      recorded: false,
      rows: [],
    };
  }

  const rows: StageRow[] = [
    { label: "Decision", value: decision.decision },
    { label: "Mode", value: decision.mode },
    { label: "Auto-approval eligible", value: decision.automatic_approval_eligible ? "yes" : "no" },
  ];
  for (const reason of decision.decision_reasons ?? []) {
    rows.push({ label: "Reason", value: reason });
  }
  for (const flag of decision.review_flags ?? []) {
    rows.push({ label: "Review flag", value: flag, tone: "muted" });
  }
  if (decision.priority) rows.push({ label: "Priority", value: `${decision.priority.value} / 10` });

  const systemFault =
    decision.decision === "data_retry" ||
    decision.decision_reasons?.includes("ai_output_invalid") ||
    decision.decision_reasons?.includes("acquisition_insufficient");

  if (systemFault) {
    return {
      key: "decision",
      title: "9. Final decision",
      state: "failed",
      headline: "Outcome was dictated by a system fault, not by the profile",
      recorded: true,
      rows,
    };
  }
  if (decision.mode === "hard_excluded") {
    return {
      key: "decision",
      title: "9. Final decision",
      state: "blocked",
      headline: "Deliberately excluded from this ICP",
      recorded: true,
      rows,
    };
  }
  if (decision.mode === "manual_review") {
    return {
      key: "decision",
      title: "9. Final decision",
      state: "degraded",
      headline: "Routed to a human for review",
      recorded: true,
      rows,
    };
  }

  return {
    key: "decision",
    title: "9. Final decision",
    state: "ok",
    headline: `${decision.decision} (${decision.mode})`,
    recorded: true,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Run-level rollup
// ---------------------------------------------------------------------------

export type RunHealth = "healthy" | "degraded" | "broken";

/**
 * A run is broken when failures dominate, which must be legible from the list
 * without opening anything — the 2026-08-01 batch was 93% failed and looked
 * identical to a healthy run.
 */
export function runHealth(run: {
  processed_count: number;
  acquisition_failed_count: number;
  extraction_failed_count: number;
  persist_failed_count: number;
}): { health: RunHealth; failureRate: number; failures: number } {
  const failures =
    run.acquisition_failed_count + run.extraction_failed_count + run.persist_failed_count;
  const denominator = Math.max(run.processed_count + run.acquisition_failed_count, 1);
  const failureRate = failures / denominator;
  const health: RunHealth = failureRate > 0.2 ? "broken" : failureRate > 0.05 ? "degraded" : "healthy";
  return { health, failureRate, failures };
}

// ---------------------------------------------------------------------------
// Slots — the run-level board
//
// Where `deriveStages` answers "what happened to this one lead", slots answer
// "where is the whole run jammed". Each slot is a real throttle, external
// dependency, or drop point in the live pipeline, so a pile-up is attributable
// to a specific cause rather than a vague "it's slow".
// ---------------------------------------------------------------------------

/** Ordered; a lead's `stage` column holds one of these keys. */
export const SLOTS = [
  { key: "queued", label: "Queued", note: "Enqueued, waiting for a worker" },
  { key: "acquiring", label: "Acquisition", note: "Steel browser · concurrency 1, global" },
  { key: "profile_persisted", label: "Profile saved", note: "Bio, followers, recent posts" },
  { key: "external_evidence", label: "External evidence", note: "Bio link · 6 pages, 3 hops max" },
  { key: "youtube", label: "YouTube", note: "Up to 3 video descriptions" },
  { key: "snapshot_stored", label: "Snapshot stored", note: "Immutable evidence" },
  { key: "qualification_queued", label: "Qualification queued", note: "Only when acquisition captured" },
  { key: "extracting", label: "AI extraction", note: "Haiku · concurrency 4/5" },
  { key: "challenger", label: "Challenger", note: "Opus · ~5x the extractor price" },
  { key: "deciding", label: "Decision", note: "Track, gates, scoring" },
  { key: "done", label: "Stored", note: "Decision and lead projection written" },
] as const;

export type SlotKey = (typeof SLOTS)[number]["key"];

export type Slot = {
  key: string;
  label: string;
  note: string;
  /** Currently sitting in this slot. */
  active: number;
  /** Reached this slot at some point (active + everything downstream). */
  entered: number;
  failed: number;
  blocked: number;
  /** Active here for longer than the stall threshold — the jam signal. */
  stuck: number;
};

/**
 * A lead that has not moved in this long is treated as stuck. Acquisition runs
 * one at a time behind a 180s Steel session, so a queue of 20 legitimately
 * takes an hour — the threshold has to sit well above one lead's worst case or
 * every healthy run looks jammed.
 */
export const STALL_MS = 10 * 60 * 1000;

export type SlotLeadRecord = {
  stage: string | null;
  status: string;
  stage_entered_at: string | null;
  extraction_ok: boolean | null;
  decision: string | null;
  mode: string | null;
};

export function computeSlots(leads: readonly SlotLeadRecord[], now = Date.now()): Slot[] {
  const index = new Map<string, number>(SLOTS.map((slot, i) => [slot.key, i]));

  return SLOTS.map((slot, position) => {
    let active = 0;
    let entered = 0;
    let failed = 0;
    let blocked = 0;
    let stuck = 0;

    for (const lead of leads) {
      // A lead with no stage predates stage tracking; it cannot be placed.
      if (!lead.stage) continue;
      const at = index.get(lead.stage);
      if (at === undefined) continue;

      // Reaching a later slot implies having passed through this one.
      if (at >= position) entered += 1;

      if (at !== position) continue;
      const terminated =
        lead.status === "acquisition_failed" || lead.status === "persist_failed";

      if (terminated) {
        failed += 1;
        continue;
      }
      if (lead.mode === "hard_excluded") {
        blocked += 1;
        continue;
      }
      // An extraction that failed is a defect, not a weak lead — same
      // distinction stage 6 of the per-lead trace makes.
      if (slot.key === "extracting" && lead.extraction_ok === false) {
        failed += 1;
        continue;
      }

      active += 1;
      if (lead.stage_entered_at && now - new Date(lead.stage_entered_at).getTime() > STALL_MS) {
        stuck += 1;
      }
    }

    return { key: slot.key, label: slot.label, note: slot.note, active, entered, failed, blocked, stuck };
  });
}

/**
 * The slot the run is most likely jammed at: most stuck leads, falling back to
 * the biggest drop between consecutive slots.
 */
export function findJam(slots: readonly Slot[]): { slot: Slot; reason: string } | null {
  const mostStuck = [...slots].sort((a, b) => b.stuck - a.stuck)[0];
  if (mostStuck && mostStuck.stuck > 0) {
    return {
      slot: mostStuck,
      reason: `${mostStuck.stuck} lead(s) have not moved in over ${Math.round(STALL_MS / 60000)} minutes`,
    };
  }

  let worst: { slot: Slot; lost: number } | null = null;
  for (let i = 1; i < slots.length; i++) {
    const lost = slots[i - 1].entered - slots[i].entered;
    if (lost > 0 && (!worst || lost > worst.lost)) worst = { slot: slots[i], lost };
  }
  if (worst && worst.lost > 0) {
    return {
      slot: worst.slot,
      reason: `${worst.lost} lead(s) did not reach ${worst.slot.label}`,
    };
  }
  return null;
}
