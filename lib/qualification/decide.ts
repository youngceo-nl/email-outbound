/*
 * Final decision routing.
 *
 * Order is the whole point:
 *   universal exclusion -> pre-existing hard business-model gate -> the
 *   PDF's four ICP gates (icp-gates.ts) -> unresolved-agency review ->
 *   the 12-point score band -> certainty -> automatic approval
 *
 * The pre-existing hard business-model gate stays first and unchanged: it
 * encodes done-for-you-service-primary detection and the agency-owner
 * exception with more nuance (mixed-offer handling, "agency evidence next to
 * an information outcome" false-positive defense) than the PDF's own Gate 3
 * exception alone, and rewriting it would discard tested, incident-driven
 * behavior the PDF doesn't address at all. The four ICP gates
 * (lib/qualification/icp-gates.ts) are what the PDF actually adds: follower
 * floor, personal brand (text + vision), coach/consultant, relevant offer.
 *
 * `qualification` (the PDF's literal QUALIFIED_HIGH_PRIORITY/QUALIFIED/
 * MANUAL_REVIEW/REJECTED) is a pure function of the gates and the score —
 * always the honest answer. `decision`/`mode` are the OPERATIONAL routing:
 * the same confidence/certainty safety net this pipeline has always applied
 * before executing anything irreversible. The two CAN diverge — a lead can
 * carry `qualification: "REJECTED"` alongside `decision: "review"` when the
 * evidence is not confident enough to auto-execute a rejection on. That is
 * not a shortcut; it is strictly more transparent than silently downgrading
 * the tier, and it preserves the exact asymmetric-risk posture
 * (`deriveRejectionConfidence`/`deriveCertainty`, unchanged) that fixed the
 * review-queue deadlock documented in certainty.ts.
 *
 * The 12-point score (icp-score.ts) is computed unconditionally for every
 * outcome, including hard rejections — this pipeline has always preserved
 * scores for analysis even on leads a gate rejected, and the new score is
 * pure arithmetic over already-extracted facts, so there is no cost to
 * always computing it.
 */

import type {
  Certainty,
  ChallengerResult,
  CommercialDecision,
  CommercialExtraction,
  DecisionMode,
  DecisionOutcome,
  DecisionReasonCode,
  EvidenceSnapshot,
  IcpQualificationTier,
  QualificationVersions,
  ReviewFlag,
} from "./types";
import { ACTIVE_SCORECARD, type Scorecard } from "./scorecard";
import { classifyTrack } from "./classify-track";
import { applyCoreGate, applyHardBusinessModelGate, type CoreGateResult } from "./eligibility";
import { applyIcpGates, DEFAULT_FOLLOWER_GATE, type FollowerGateConfig } from "./icp-gates";
import { scoreIcpFit } from "./icp-score";
import { deriveCertainty, deriveRejectionConfidence } from "./certainty";
import { computePriority } from "./priority";
import type { VisualIdentityResult } from "./visual-identity";
import {
  ACQUISITION_VERSION,
  CHALLENGER_PROMPT_VERSION,
  CONFIG_VERSION,
  EXTRACTION_PROMPT_VERSION,
  PIPELINE_VERSION,
  SCORECARD_VERSION,
  VISION_PROMPT_VERSION,
} from "@/lib/evidence/versions";

export type FollowerRange = { min: number | null; max: number | null };

export type DecideOptions = {
  snapshot: EvidenceSnapshot;
  extraction: CommercialExtraction;
  visualIdentity?: VisualIdentityResult | null;
  challenger: ChallengerResult | null;
  challengerAgrees: boolean | null;
  citationWarnings?: string[];
  scorecard?: Scorecard;
  followerRange?: FollowerRange;
  extractionId?: string | null;
  now?: () => string;
};

export function decideCommercialQualification(opts: DecideOptions): CommercialDecision {
  const scorecard = opts.scorecard ?? ACTIVE_SCORECARD;
  const now = opts.now ?? (() => new Date().toISOString());
  const citationWarnings = opts.citationWarnings ?? [];

  const track = classifyTrack(opts.extraction);
  const hardGate = applyHardBusinessModelGate(opts.extraction);
  const coreGate = applyCoreGate(opts.extraction);
  const rejectionConfidence = deriveRejectionConfidence({
    snapshot: opts.snapshot,
    track,
    coreGate,
    challengerAgrees: opts.challengerAgrees,
  });

  const icpGates = applyIcpGates({
    snapshot: opts.snapshot,
    extraction: opts.extraction,
    visualIdentity: opts.visualIdentity ?? null,
    followerGate: followerGateConfig(opts.followerRange),
  });

  // Computed unconditionally — see module header.
  const scoring = scoreIcpFit(opts.extraction, opts.snapshot, scorecard);

  const certainty = deriveCertainty({
    snapshot: opts.snapshot,
    extraction: opts.extraction,
    track,
    coreGate,
    challenger: opts.challenger,
    challengerAgrees: opts.challengerAgrees,
    citationWarnings,
  });

  const reasons: DecisionReasonCode[] = [];
  const flags: ReviewFlag[] = [];

  // ---- Review flags are advisory and never decide an outcome on their own. ----
  if (track.mixed) flags.push("agency_information_mixed");
  if (track.track === "uncertain") flags.push("uncertain_track");
  if (opts.extraction.conflicts.length > 0) flags.push("contradictory_evidence");
  if (opts.snapshot.activity.data_quality === "unreliable") flags.push("unreliable_data");
  if (coreGate.absent_signals.length > 0 || coreGate.unknown_signals.length > 0) {
    flags.push("missing_core_evidence");
  }
  if (opts.extraction.proof.state !== "present") flags.push("proof_unverified");
  if (opts.extraction.authority.state !== "present") flags.push("authority_unverified");

  // Agency-client proof propping up an information claim is the classic false
  // positive this ICP has to defend against.
  const agencyProof = [...opts.extraction.proof.claims, ...opts.extraction.proof_attribution].some(
    (claim) => claim.beneficiary === "agency_client",
  );
  if (agencyProof && track.track === "information_personal_brand") {
    flags.push("suspicious_proof");
  }

  const routed = route({
    snapshot: opts.snapshot,
    hardGate,
    icpGates,
    coreGate,
    certainty: certainty.certainty,
    canAutoReject: rejectionConfidence.confident,
    totalIcpScore: scoring.scores.total_icp_score,
    scorecard,
    challengerAgrees: opts.challengerAgrees,
    reasons,
  });

  const versions: QualificationVersions = {
    acquisition_version: ACQUISITION_VERSION,
    extraction_prompt_version: EXTRACTION_PROMPT_VERSION,
    challenger_prompt_version: CHALLENGER_PROMPT_VERSION,
    scorecard_version: SCORECARD_VERSION,
    config_version: CONFIG_VERSION,
    pipeline_version: PIPELINE_VERSION,
    vision_prompt_version: VISION_PROMPT_VERSION,
  };

  return {
    scorecard_version: scorecard.version,
    evidence_snapshot_id: opts.snapshot.snapshot_id,
    extraction_id: opts.extractionId ?? null,

    qualification: routed.qualification,
    icp_gates: icpGates,
    icp_scores: scoring.scores,
    icp_score_components: scoring.components,

    track: track.track,
    icp_eligible: hardGate.icp_eligible,
    hard_exclusion: hardGate.hard_exclusion,
    rejection_reason: hardGate.rejection_reason ?? routed.rejectionReason,

    signal_states: coreGate.states,
    primary_visitor_outcome: opts.extraction.primary_visitor_outcome,

    certainty: certainty.certainty,
    challenger_agreement: opts.challengerAgrees,
    challenger_result: opts.challenger,

    decision: routed.outcome,
    mode: routed.mode,
    automatic_approval_eligible: routed.autoApprove,
    decision_reasons: dedupe(routed.reasons),
    review_flags: dedupe(flags),

    priority:
      routed.outcome === "qualified" || routed.outcome === "review"
        ? computePriority(scoring.scores, opts.snapshot.activity, scorecard)
        : null,
    versions,
    decided_at: now(),

    track_reason: track.reason,
    hard_gate_reason: hardGate.reason,
    core_gate: {
      passes: coreGate.passes,
      unknown_signals: coreGate.unknown_signals,
      absent_signals: coreGate.absent_signals,
      supporting_present: coreGate.supporting_present,
    },
    certainty_reasons: certainty.reasons,
    certainty_blockers: certainty.blockers,
  };
}

function followerGateConfig(range: FollowerRange | undefined): FollowerGateConfig {
  return {
    min: range?.min ?? DEFAULT_FOLLOWER_GATE.min,
    max: range?.max ?? DEFAULT_FOLLOWER_GATE.max,
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function route(args: {
  snapshot: EvidenceSnapshot;
  hardGate: ReturnType<typeof applyHardBusinessModelGate>;
  icpGates: ReturnType<typeof applyIcpGates>;
  coreGate: CoreGateResult;
  certainty: Certainty;
  /** Evidence is complete enough to reject without a human — see deriveRejectionConfidence. */
  canAutoReject: boolean;
  totalIcpScore: number;
  scorecard: Scorecard;
  challengerAgrees: boolean | null;
  reasons: DecisionReasonCode[];
}): {
  outcome: DecisionOutcome;
  mode: DecisionMode;
  autoApprove: boolean;
  /** Undefined only for data_retry — a lead we never actually got to judge has no tier. */
  qualification: IcpQualificationTier | undefined;
  rejectionReason: DecisionReasonCode | null;
  reasons: DecisionReasonCode[];
} {
  const reasons = args.reasons;

  // ---- 1. Pre-existing hard business-model gate, before any score. ----
  if (args.hardGate.hard_exclusion) {
    reasons.push("primary_offer_done_for_you_service");
    return finalize(args, "rejected", "hard_excluded", false, "REJECTED", "primary_offer_done_for_you_service", reasons);
  }

  /*
   * ---- 2. Data quality: unknown evidence is a retry, never a rejection. ----
   * Must run before the PDF gates — evaluating Gate 1 (follower count) or any
   * other gate against a profile that was never actually captured would
   * misreport "unknown" as a considered judgment rather than a failed fetch.
   */
  if (args.snapshot.instagram.profile_capture_status !== "captured") {
    reasons.push("profile_unavailable");
    return dataRetry(reasons);
  }
  if (
    args.snapshot.activity.data_quality === "unreliable" &&
    args.coreGate.unknown_signals.length > 0
  ) {
    reasons.push("unreliable_data", "core_signal_unknown");
    return dataRetry(reasons);
  }

  // ---- 3. The PDF's four gates. ----
  if (args.icpGates.outcome === "reject") {
    reasons.push(args.icpGates.rejection_reason as DecisionReasonCode);
    if (args.canAutoReject) {
      return finalize(args, "rejected", "hard_excluded", false, "REJECTED", args.icpGates.rejection_reason, reasons);
    }
    // Not confident enough to execute the rejection automatically — the
    // literal tier is still REJECTED, a human just has to pull the trigger.
    return finalize(args, "review", "manual_review", false, "REJECTED", args.icpGates.rejection_reason, reasons);
  }
  if (args.icpGates.outcome === "manual_review") {
    reasons.push(...args.icpGates.review_reasons);
    return finalize(args, "review", "manual_review", false, "MANUAL_REVIEW", null, reasons);
  }

  /*
   * ---- 4. Unknown information_funnel or CTA signal. ----
   * None of the PDF's four gates check these two signals directly — Gate 2
   * already folds human_personal_brand's own unknown case into "uncertain",
   * but information_funnel and cta have no PDF-gate equivalent at all. This
   * pipeline's core safety invariant is that an unseen surface must never be
   * treated as though it were fine (see certainty.ts, eligibility.ts) —
   * without this check a profile whose funnel or CTA was simply never
   * captured would fall straight through to scoring and could score high
   * enough to qualify on facts nobody actually saw.
   */
  const unseenCoreSignals = args.coreGate.unknown_signals.filter(
    (signal) => signal === "information_funnel" || signal === "cta",
  );
  if (unseenCoreSignals.length > 0) {
    reasons.push("core_signal_unknown");
    return finalize(args, "review", "manual_review", false, "MANUAL_REVIEW", null, reasons);
  }

  // ---- 5. Unresolved business model (pre-existing hard gate's mixed case). ----
  if (args.hardGate.needs_review) {
    reasons.push("agency_information_mixed");
    return finalize(args, "review", "manual_review", false, "MANUAL_REVIEW", null, reasons);
  }

  // ---- 6. Score band ----
  const tier = tierFromScore(args.totalIcpScore, args.scorecard);

  if (tier === "REJECTED") {
    reasons.push("icp_score_below_threshold");
    if (args.canAutoReject) {
      return finalize(args, "rejected", "hard_excluded", false, tier, "icp_score_below_threshold", reasons);
    }
    return finalize(args, "review", "manual_review", false, tier, "icp_score_below_threshold", reasons);
  }
  if (tier === "MANUAL_REVIEW") {
    reasons.push("icp_score_review_band");
    return finalize(args, "review", "manual_review", false, tier, null, reasons);
  }

  reasons.push("information_personal_brand", "core_gate_passes");
  if (tier === "QUALIFIED_HIGH_PRIORITY") reasons.push("icp_score_high_priority");

  // ---- 7. Automatic approval — QUALIFIED_HIGH_PRIORITY only. ----
  const autoBlockers: DecisionReasonCode[] = [];
  if (tier !== "QUALIFIED_HIGH_PRIORITY") autoBlockers.push("score_in_review_band");
  if (args.certainty !== "high") autoBlockers.push("acquisition_insufficient");
  if (args.challengerAgrees === false) autoBlockers.push("challenger_disagreement");

  if (autoBlockers.length > 0) {
    reasons.push(...autoBlockers);
    return finalize(args, "qualified", "manual_review", false, tier, null, reasons);
  }

  return finalize(args, "qualified", "auto_approved", true, tier, null, reasons);
}

function finalize(
  _args: unknown,
  outcome: DecisionOutcome,
  mode: DecisionMode,
  autoApprove: boolean,
  qualification: IcpQualificationTier,
  rejectionReason: DecisionReasonCode | null,
  reasons: DecisionReasonCode[],
) {
  return { outcome, mode, autoApprove, qualification, rejectionReason, reasons };
}

function dataRetry(reasons: DecisionReasonCode[]) {
  return {
    outcome: "data_retry" as const,
    mode: "retry_required" as const,
    autoApprove: false,
    qualification: undefined,
    rejectionReason: null,
    reasons,
  };
}

function tierFromScore(total: number, scorecard: Scorecard): IcpQualificationTier {
  const t = scorecard.thresholds;
  if (total >= t.qualified_high_priority_min) return "QUALIFIED_HIGH_PRIORITY";
  if (total >= t.qualified_min) return "QUALIFIED";
  if (total >= t.manual_review_min) return "MANUAL_REVIEW";
  return "REJECTED";
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
