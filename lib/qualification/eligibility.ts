/*
 * Hard business-model gate and core gate.
 *
 * The hard gate runs BEFORE any weighted score exists and cannot be overturned
 * by one. A done-for-you agency with a commercial-fit score of 10 is still
 * rejected — the score is preserved for analysis, never for eligibility.
 */

import type {
  CommercialExtraction,
  DecisionReasonCode,
  SignalState,
  SignalStates,
} from "./types";
import { informationOffers } from "./classify-track";

export type HardGateResult = {
  icp_eligible: boolean;
  hard_exclusion: boolean;
  rejection_reason: DecisionReasonCode | null;
  reason: string;
  /** Set when the agency exception was evaluated and the evidence was mixed. */
  needs_review: boolean;
};

export function applyHardBusinessModelGate(extraction: CommercialExtraction): HardGateResult {
  const bundle = extraction.agency_evidence_bundle;
  const outcome = extraction.primary_visitor_outcome;

  const agencyOutcome = outcome === "done_for_you_service";
  const agencyReliable = bundle.reliability === "reliable";

  if (agencyOutcome && agencyReliable) {
    /*
     * The only escape: a genuinely independent information offer. Agency case
     * studies, business-advice posts, and educational videos whose next CTA is
     * "hire us" do not create it — those all still deliver service work.
     */
    const independent = findIndependentInformationFunnel(extraction);
    if (independent.verified) {
      return {
        icp_eligible: true,
        hard_exclusion: false,
        rejection_reason: null,
        reason: `done-for-you primary, but an independent information funnel is verified: ${independent.reason}`,
        needs_review: true,
      };
    }
    return {
      icp_eligible: false,
      hard_exclusion: true,
      rejection_reason: "primary_offer_done_for_you_service",
      reason: `primary visitor outcome is done_for_you_service with reliable agency evidence (${independent.reason})`,
      needs_review: false,
    };
  }

  /*
   * Agency evidence that is present but not reliable, or an agency outcome
   * without a corroborated bundle, is exactly the "unresolved mixed offer" the
   * spec sends to targeted review rather than rejecting or qualifying.
   */
  if (agencyOutcome && !agencyReliable) {
    return {
      icp_eligible: true,
      hard_exclusion: false,
      rejection_reason: null,
      reason: "done-for-you outcome but agency evidence is not reliable",
      needs_review: true,
    };
  }
  if (agencyReliable && !agencyOutcome) {
    return {
      icp_eligible: true,
      hard_exclusion: false,
      rejection_reason: null,
      reason: "reliable agency evidence exists but is not the primary visitor outcome",
      needs_review: true,
    };
  }

  return {
    icp_eligible: true,
    hard_exclusion: false,
    rejection_reason: null,
    reason: "no reliable done-for-you primary outcome",
    needs_review: false,
  };
}

/*
 * The agency exception. The extractor reports each component of the separate
 * information funnel independently; this function decides whether the exception
 * passes. All five components must be `present` — a funnel missing its own
 * audience, outcome, CTA path, information delivery, or commercial prominence is
 * a bonus attached to the service, not a business that stands on its own.
 */
export function findIndependentInformationFunnel(extraction: CommercialExtraction): {
  verified: boolean;
  reason: string;
} {
  const components = extraction.independent_information_offer;
  if (components) {
    const required = [
      ["own_audience", components.own_audience],
      ["own_transformation", components.own_transformation],
      ["own_cta_path", components.own_cta_path],
      ["information_delivery", components.information_delivery],
      ["sufficient_prominence", components.sufficient_prominence],
    ] as const;

    const failing = required.filter(([, state]) => state !== "present");
    if (failing.length > 0) {
      return {
        verified: false,
        reason: `independent funnel components not established: ${failing
          .map(([name, state]) => `${name}=${state}`)
          .join(", ")}`,
      };
    }
    if (components.evidence.length === 0) {
      return { verified: false, reason: "independent funnel asserted without cited evidence" };
    }
    return {
      verified: true,
      reason: "all five independent information-funnel components are present and cited",
    };
  }

  // Fallback for extractions that predate the component-wise contract.
  const candidates = informationOffers(extraction.offers);
  if (candidates.length === 0) {
    return { verified: false, reason: "no offer delivers knowledge or instruction to the visitor" };
  }

  // Its own CTA, distinct from the service consultation path.
  const withCta = candidates.filter((offer) => Boolean(offer.cta) && offer.evidence.length > 0);
  if (withCta.length === 0) {
    return { verified: false, reason: "information offers have no cited CTA of their own" };
  }

  if (extraction.information_funnel.state !== "present") {
    return {
      verified: false,
      reason: `information funnel signal is ${extraction.information_funnel.state}`,
    };
  }

  /*
   * "Would the information offer still exist if the agency service were
   * removed?" An incidental offer is a bonus attached to the service, not a
   * business that stands on its own.
   */
  const standalone = withCta.filter((offer) => offer.prominence !== "incidental");
  if (standalone.length === 0) {
    return { verified: false, reason: "information offers are only incidental to the service" };
  }

  return {
    verified: true,
    reason: `${standalone.length} independent information offer(s) with their own CTA`,
  };
}

// ---------------------------------------------------------------------------
// Core gate
// ---------------------------------------------------------------------------

export type CoreGateResult = {
  passes: boolean;
  states: SignalStates;
  /** Core signals that were never captured, as opposed to captured and absent. */
  unknown_signals: string[];
  absent_signals: string[];
  reasons: DecisionReasonCode[];
  supporting_present: string[];
};

export function applyCoreGate(extraction: CommercialExtraction): CoreGateResult {
  const states: SignalStates = {
    human_personal_brand: extraction.human_personal_brand.state,
    information_funnel: extraction.information_funnel.state,
    cta: extraction.cta.state,
    transformation: extraction.transformation.state,
    proof: extraction.proof.state,
    authority: extraction.authority.state,
  };

  const required: Array<[string, SignalState]> = [
    ["human_personal_brand", states.human_personal_brand],
    ["information_funnel", states.information_funnel],
    ["cta", states.cta],
  ];

  const unknown = required.filter(([, state]) => state === "unknown" || state === "conflicting");
  const absent = required.filter(([, state]) => state === "absent");

  const supporting = (["transformation", "proof", "authority"] as const).filter(
    (signal) => states[signal] === "present",
  );

  const reasons: DecisionReasonCode[] = [];
  if (unknown.length > 0) reasons.push("core_signal_unknown");
  if (absent.length > 0) reasons.push("missing_core_evidence");
  if (supporting.length === 0 && unknown.length === 0 && absent.length === 0) {
    reasons.push("missing_core_evidence");
  }

  const passes =
    required.every(([, state]) => state === "present") && supporting.length >= 1;

  if (passes) reasons.push("core_gate_passes");

  return {
    passes,
    states,
    unknown_signals: unknown.map(([name]) => name),
    absent_signals: absent.map(([name]) => name),
    reasons,
    supporting_present: supporting,
  };
}
