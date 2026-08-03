/*
 * Final decision routing.
 *
 * Order is the whole point:
 *   universal exclusion -> hard business-model gate -> core gate -> score bands
 *     -> certainty -> automatic approval
 *
 * Scores are computed and preserved for every outcome, including rejections, so
 * a hard-excluded agency still carries its commercial strength for analysis
 * without that strength ever being able to restore eligibility.
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
  QualificationVersions,
  ReviewFlag,
} from "./types";
import { ACTIVE_SCORECARD, type Scorecard } from "./scorecard";
import { classifyTrack } from "./classify-track";
import { applyCoreGate, applyHardBusinessModelGate } from "./eligibility";
import { scoreCommercialFit } from "./score";
import { deriveCertainty, deriveRejectionConfidence } from "./certainty";
import { computePriority } from "./priority";
import {
  ACQUISITION_VERSION,
  CHALLENGER_PROMPT_VERSION,
  CONFIG_VERSION,
  EXTRACTION_PROMPT_VERSION,
  PIPELINE_VERSION,
  SCORECARD_VERSION,
} from "@/lib/evidence/versions";

export type FollowerRange = { min: number | null; max: number | null };

export type DecideOptions = {
  snapshot: EvidenceSnapshot;
  extraction: CommercialExtraction;
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
  const scoring = scoreCommercialFit(opts.extraction, opts.snapshot, scorecard);

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

  const followerFlag = isOutsideFollowerRange(
    opts.snapshot.instagram.followers,
    opts.followerRange,
  );
  if (followerFlag) flags.push("follower_range");

  // Agency-client proof propping up an information claim is the classic false
  // positive this ICP has to defend against.
  const agencyProof = [...opts.extraction.proof.claims, ...opts.extraction.proof_attribution].some(
    (claim) => claim.beneficiary === "agency_client",
  );
  if (agencyProof && track.track === "information_personal_brand") {
    flags.push("suspicious_proof");
  }

  const decision = route({
    track,
    hardGate,
    coreGate,
    certainty: certainty.certainty,
    canAutoReject: rejectionConfidence.confident,
    commercialFit: scoring.scores.commercial_fit,
    informationFunnelScore: scoring.scores.information_funnel_evidence,
    conversionIntentScore: scoring.scores.conversion_intent,
    snapshot: opts.snapshot,
    extraction: opts.extraction,
    scorecard,
    challengerAgrees: opts.challengerAgrees,
    followerFlag,
    reasons,
  });

  const versions: QualificationVersions = {
    acquisition_version: ACQUISITION_VERSION,
    extraction_prompt_version: EXTRACTION_PROMPT_VERSION,
    challenger_prompt_version: CHALLENGER_PROMPT_VERSION,
    scorecard_version: SCORECARD_VERSION,
    config_version: CONFIG_VERSION,
    pipeline_version: PIPELINE_VERSION,
  };

  return {
    scorecard_version: scorecard.version,
    evidence_snapshot_id: opts.snapshot.snapshot_id,
    extraction_id: opts.extractionId ?? null,

    track: track.track,
    icp_eligible: hardGate.icp_eligible,
    hard_exclusion: hardGate.hard_exclusion,
    rejection_reason: hardGate.rejection_reason,

    signal_states: coreGate.states,
    primary_visitor_outcome: opts.extraction.primary_visitor_outcome,

    scores: scoring.scores,
    score_components: scoring.components,

    certainty: certainty.certainty,
    challenger_agreement: opts.challengerAgrees,
    challenger_result: opts.challenger,

    decision: decision.outcome,
    mode: decision.mode,
    automatic_approval_eligible: decision.autoApprove,
    decision_reasons: dedupe(decision.reasons),
    review_flags: dedupe(flags),

    priority:
      decision.outcome === "qualified" || decision.outcome === "review"
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

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function route(args: {
  track: ReturnType<typeof classifyTrack>;
  hardGate: ReturnType<typeof applyHardBusinessModelGate>;
  coreGate: ReturnType<typeof applyCoreGate>;
  certainty: Certainty;
  /** Evidence is complete enough to reject without a human — see deriveRejectionConfidence. */
  canAutoReject: boolean;
  commercialFit: number;
  informationFunnelScore: number;
  conversionIntentScore: number;
  snapshot: EvidenceSnapshot;
  extraction: CommercialExtraction;
  scorecard: Scorecard;
  challengerAgrees: boolean | null;
  followerFlag: boolean;
  reasons: DecisionReasonCode[];
}): {
  outcome: DecisionOutcome;
  mode: DecisionMode;
  autoApprove: boolean;
  reasons: DecisionReasonCode[];
} {
  const reasons = args.reasons;
  const thresholds = args.scorecard.thresholds;

  // ---- 1. Hard business-model gate, before any score is consulted. ----
  if (args.hardGate.hard_exclusion) {
    reasons.push("primary_offer_done_for_you_service");
    return { outcome: "rejected", mode: "hard_excluded", autoApprove: false, reasons };
  }

  // ---- 2. Data quality: unknown evidence is a retry, never a rejection. ----
  if (args.snapshot.instagram.profile_capture_status !== "captured") {
    reasons.push("profile_unavailable");
    return { outcome: "data_retry", mode: "retry_required", autoApprove: false, reasons };
  }
  if (args.snapshot.activity.data_quality === "unreliable" && args.coreGate.unknown_signals.length > 0) {
    reasons.push("unreliable_data", "core_signal_unknown");
    return { outcome: "data_retry", mode: "retry_required", autoApprove: false, reasons };
  }

  // ---- 3. Core gate ----
  if (!args.coreGate.passes) {
    /*
     * An unknown core signal means we could not see it, so the lead goes to a
     * human rather than the bin. An absent core signal on a captured surface
     * with a genuinely weak score is a real rejection.
     */
    if (args.coreGate.unknown_signals.length > 0) {
      reasons.push("core_signal_unknown");
      return { outcome: "review", mode: "manual_review", autoApprove: false, reasons };
    }
    reasons.push("missing_core_evidence");
    if (args.commercialFit <= thresholds.rejected_max && args.canAutoReject) {
      return { outcome: "rejected", mode: "hard_excluded", autoApprove: false, reasons };
    }
    return { outcome: "review", mode: "manual_review", autoApprove: false, reasons };
  }

  /*
   * ---- 4. Unresolved business model ----
   * This must precede the track check. When the hard gate grants the
   * independent-information-funnel exception, the deterministic track still
   * reads `agency_service` from the primary visitor outcome — letting the track
   * check run first would auto-reject exactly the agency owner the exception
   * exists to protect. An unresolved model is a question for a human.
   */
  if (args.hardGate.needs_review) {
    reasons.push("agency_information_mixed");
    return { outcome: "review", mode: "manual_review", autoApprove: false, reasons };
  }

  // ---- 5. Track eligibility ----
  if (args.track.track === "uncertain") {
    reasons.push("uncertain_track");
    return { outcome: "review", mode: "manual_review", autoApprove: false, reasons };
  }
  if (args.track.track !== "information_personal_brand") {
    reasons.push("excluded_track");
    /*
     * Rejecting an off-ICP track needs only that we saw the profile clearly and
     * resolved the business model — not the full approval bar. Gating this on
     * `certainty === "high"` sent 44 streetwear brands to manual review.
     */
    if (args.canAutoReject) {
      return { outcome: "rejected", mode: "hard_excluded", autoApprove: false, reasons };
    }
    return { outcome: "review", mode: "manual_review", autoApprove: false, reasons };
  }
  reasons.push("information_personal_brand");

  // ---- 6. Score bands ----
  if (args.commercialFit <= thresholds.rejected_max) {
    reasons.push("score_below_threshold");
    if (args.canAutoReject) {
      return { outcome: "rejected", mode: "hard_excluded", autoApprove: false, reasons };
    }
    return { outcome: "review", mode: "manual_review", autoApprove: false, reasons };
  }
  if (args.commercialFit < thresholds.qualified_min) {
    reasons.push("score_in_review_band");
    return { outcome: "review", mode: "manual_review", autoApprove: false, reasons };
  }

  reasons.push("core_gate_passes");

  // ---- 7. Automatic approval ----
  const autoBlockers: DecisionReasonCode[] = [];
  if (args.certainty !== "high") autoBlockers.push("acquisition_insufficient");
  if (args.informationFunnelScore < thresholds.min_information_funnel) {
    autoBlockers.push("missing_core_evidence");
  }
  if (args.conversionIntentScore < thresholds.min_conversion_intent) {
    autoBlockers.push("missing_core_evidence");
  }
  if (args.challengerAgrees === false) autoBlockers.push("challenger_disagreement");
  if (args.followerFlag) autoBlockers.push("follower_range");

  if (autoBlockers.length > 0) {
    reasons.push(...autoBlockers);
    return { outcome: "qualified", mode: "manual_review", autoApprove: false, reasons };
  }

  return { outcome: "qualified", mode: "auto_approved", autoApprove: true, reasons };
}

function isOutsideFollowerRange(
  followers: number | null,
  range: FollowerRange | undefined,
): boolean {
  if (!range || followers === null) return false;
  if (range.min !== null && followers < range.min) return true;
  if (range.max !== null && followers > range.max) return true;
  return false;
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
