/*
 * The four hard gates from "Revised Instagram ICP Qualification Logic".
 *
 * Order matches the spec's "2. Immediate Classification Logic" exactly:
 * follower count first (fail -> reject, unknown -> review), then personal
 * brand, coach/consultant, relevant offer — any clear fail rejects, any
 * uncertain sends the lead to a human, and only a lead that clears all four
 * ever reaches the 12-point scorer in icp-score.ts.
 *
 * These gates run BEFORE any score exists and are never overturned by one —
 * same principle as the pre-existing applyHardBusinessModelGate in
 * eligibility.ts, which this module reuses rather than duplicates for the
 * agency-owner exception.
 */

import type {
  CommercialExtraction,
  DecisionReasonCode,
  EvidenceSnapshot,
  GateResult,
  IcpGateResults,
  OfferType,
} from "./types";
import { findIndependentInformationFunnel } from "./eligibility";
import {
  visualIdentityEvidence,
  visualIdentitySignalState,
  type VisualIdentityResult,
} from "./visual-identity";

export type FollowerGateConfig = { min: number; max: number | null };

/** The spec's own threshold: 5,000 followers, no ceiling. */
export const DEFAULT_FOLLOWER_GATE: FollowerGateConfig = { min: 5000, max: null };

export type IcpGateOutcome = "reject" | "manual_review" | "score";

export type IcpGatesResult = IcpGateResults & {
  outcome: IcpGateOutcome;
  rejection_reason: DecisionReasonCode | null;
  review_reasons: DecisionReasonCode[];
};

export function applyIcpGates(opts: {
  snapshot: EvidenceSnapshot;
  extraction: CommercialExtraction;
  visualIdentity: VisualIdentityResult | null;
  followerGate?: FollowerGateConfig;
}): IcpGatesResult {
  const config = opts.followerGate ?? DEFAULT_FOLLOWER_GATE;
  const followers = opts.snapshot.instagram.followers;

  // ---- Gate 1: Minimum Audience Size ----
  const followerGate: "pass" | "fail" | "unknown" =
    followers === null
      ? "unknown"
      : followers < config.min || (config.max !== null && followers > config.max)
        ? "fail"
        : "pass";

  if (followerGate === "fail") {
    const notEvaluated = uncomputed("not evaluated — the follower gate failed first");
    return {
      follower_gate: followerGate,
      personal_brand: notEvaluated,
      coach_or_consultant: notEvaluated,
      relevant_offer: notEvaluated,
      outcome: "reject",
      rejection_reason: "follower_below_minimum",
      review_reasons: [],
    };
  }

  // Gates 2-4 are always evaluated even when the follower count is unknown,
  // so the stored decision carries full evidence rather than three blank
  // gates — but an unknown follower count is what actually decides the
  // outcome here, per the spec: "MANUAL_REVIEW... not automatically qualify
  // or reject."
  const personalBrand = evaluatePersonalBrandGate(opts.extraction, opts.visualIdentity);
  const coachOrConsultant = evaluateCoachOrConsultantGate(opts.extraction);
  const relevantOffer = evaluateRelevantOfferGate(opts.extraction, opts.snapshot);

  if (followerGate === "unknown") {
    return {
      follower_gate: followerGate,
      personal_brand: personalBrand,
      coach_or_consultant: coachOrConsultant,
      relevant_offer: relevantOffer,
      outcome: "manual_review",
      rejection_reason: null,
      review_reasons: ["follower_count_unknown"],
    };
  }

  // ---- Gates 2-4: any clear fail rejects, in spec order ----
  if (personalBrand.status === "fail") {
    return finalize(followerGate, personalBrand, coachOrConsultant, relevantOffer, "reject", "personal_brand_gate_failed");
  }
  if (coachOrConsultant.status === "fail") {
    return finalize(followerGate, personalBrand, coachOrConsultant, relevantOffer, "reject", "coach_or_consultant_gate_failed");
  }
  if (relevantOffer.status === "fail") {
    return finalize(followerGate, personalBrand, coachOrConsultant, relevantOffer, "reject", "relevant_offer_gate_failed");
  }

  // ---- Any gate uncertain -> MANUAL_REVIEW ----
  const reviewReasons: DecisionReasonCode[] = [];
  if (personalBrand.status === "uncertain") reviewReasons.push("personal_brand_gate_uncertain");
  if (coachOrConsultant.status === "uncertain") reviewReasons.push("coach_or_consultant_gate_uncertain");
  if (relevantOffer.status === "uncertain") reviewReasons.push("relevant_offer_gate_uncertain");
  if (reviewReasons.length > 0) {
    return {
      follower_gate: followerGate,
      personal_brand: personalBrand,
      coach_or_consultant: coachOrConsultant,
      relevant_offer: relevantOffer,
      outcome: "manual_review",
      rejection_reason: null,
      review_reasons: reviewReasons,
    };
  }

  return {
    follower_gate: followerGate,
    personal_brand: personalBrand,
    coach_or_consultant: coachOrConsultant,
    relevant_offer: relevantOffer,
    outcome: "score",
    rejection_reason: null,
    review_reasons: [],
  };
}

function finalize(
  followerGate: "pass" | "fail" | "unknown",
  personalBrand: GateResult,
  coachOrConsultant: GateResult,
  relevantOffer: GateResult,
  outcome: IcpGateOutcome,
  rejectionReason: DecisionReasonCode,
): IcpGatesResult {
  return {
    follower_gate: followerGate,
    personal_brand: personalBrand,
    coach_or_consultant: coachOrConsultant,
    relevant_offer: relevantOffer,
    outcome,
    rejection_reason: rejectionReason,
    review_reasons: [],
  };
}

function uncomputed(reason: string): GateResult {
  return { status: "uncertain", evidence: [], reason };
}

// ---------------------------------------------------------------------------
// Gate 2 — Personal Brand
// ---------------------------------------------------------------------------

/*
 * Combines the text signal with the vision pass. PASS is reachable from
 * either signal alone reading "present" — vision is corroborating evidence,
 * not a requirement, since many snapshots will have no captured images at
 * all (vision reads "unknown" then) and that must not block a lead the text
 * evidence clearly supports.
 *
 * FAIL is the stricter path: it requires that no signal contradicts an
 * absence. By the time this function reaches the fail check, neither signal
 * read "present" (both would have returned above), so "at least one reads
 * absent" is exactly the user's rule: reject only when text and vision both
 * independently support absent, or one is absent and the other is
 * absent/unknown. A present-vs-absent disagreement can never reach this
 * branch — it would have returned PASS already.
 */
function evaluatePersonalBrandGate(
  extraction: CommercialExtraction,
  visualIdentity: VisualIdentityResult | null,
): GateResult {
  const textState = extraction.human_personal_brand.state;
  const visionFacts = visualIdentity?.ok ? visualIdentity.facts : null;
  const visionState = visualIdentitySignalState(visionFacts);
  const evidence = [...extraction.human_personal_brand.evidence, ...visualIdentityEvidence(visionFacts)];

  if (textState === "present") {
    return { status: "pass", evidence, reason: `text signal present (vision=${visionState})` };
  }
  if (visionState === "present") {
    return { status: "pass", evidence, reason: `vision signal present (text=${textState})` };
  }
  if (textState === "absent" || visionState === "absent") {
    return { status: "fail", evidence, reason: `text=${textState}, vision=${visionState}` };
  }
  return {
    status: "uncertain",
    evidence,
    reason: `text=${textState}, vision=${visionState} — no positive or negative evidence`,
  };
}

// ---------------------------------------------------------------------------
// Gate 3 — Coach or Consultant
// ---------------------------------------------------------------------------

function evaluateCoachOrConsultantGate(extraction: CommercialExtraction): GateResult {
  const signal = extraction.coach_or_consultant;
  if (!signal) {
    return uncomputed("extraction predates the coach_or_consultant field (older extraction_prompt_version)");
  }
  if (signal.state === "present") {
    return { status: "pass", evidence: signal.evidence, reason: "coach_or_consultant signal present" };
  }
  if (signal.state === "absent") {
    /*
     * Agency-owner exception. Reuses findIndependentInformationFunnel
     * (eligibility.ts) rather than reimplementing it — "does a real
     * independent coaching/course business exist alongside the agency" is
     * the same question under a different name, and the existing function
     * already requires all five components (own audience, own
     * transformation, own CTA path, information delivery, sufficient
     * prominence) to be present and cited.
     *
     * The exception is scoped to agency owners specifically — the PDF is
     * explicit ("an agency owner qualifies only when..."). Without checking
     * for agency evidence first, findIndependentInformationFunnel's fallback
     * path (any offer with its own CTA) verifies for practically any normal
     * coaching business, which would turn "absent, no exception" into
     * "uncertain" for leads that were never agencies in the first place —
     * defeating the point of Gate 3 being able to fail cleanly.
     */
    const hasAgencySignal =
      extraction.business_models.some((model) => model.type === "agency_service") ||
      extraction.agency_evidence_bundle.reliability !== "absent";

    if (hasAgencySignal) {
      const exception = findIndependentInformationFunnel(extraction);
      if (exception.verified) {
        return {
          status: "uncertain",
          evidence: extraction.independent_information_offer?.evidence ?? [],
          reason: `coach_or_consultant absent but an independent information funnel is verified: ${exception.reason}`,
        };
      }
    }
    return {
      status: "fail",
      evidence: signal.evidence,
      reason: "coach_or_consultant absent and no agency-owner exception applies",
    };
  }
  return { status: "uncertain", evidence: signal.evidence, reason: `coach_or_consultant is ${signal.state}` };
}

// ---------------------------------------------------------------------------
// Gate 4 — Relevant Offer
// ---------------------------------------------------------------------------

/** Offer types the spec accepts as a relevant coaching/consulting/course offer. */
const ACCEPTED_OFFER_TYPES: OfferType[] = [
  "coaching",
  "information_product",
  "community",
  "membership",
  "event",
  "done_with_you_consulting",
];

/*
 * The spec's own CTA-text examples for Gate 4 strong evidence: "Apply for
 * coaching", "Book a consultation", an application funnel. Matched against
 * an offer's cta text as a fallback for when the destination classifier
 * didn't tag the page itself as application/booking (e.g. an unrendered or
 * partially-captured page).
 */
const APPLICATION_OR_BOOKING_CTA_PATTERN =
  /\b(appl(y|ication)|book (a|your) (call|consult(ation)?|session)|schedule (a|your) call)\b/i;

/** True when a captured destination shows a real application or booking funnel. */
function hasApplicationOrBookingFunnel(snapshot: EvidenceSnapshot): boolean {
  return snapshot.external_destinations.some(
    (destination) =>
      destination.capture_status === "captured" &&
      (destination.destination_type === "application" || destination.destination_type === "booking"),
  );
}

function evaluateRelevantOfferGate(extraction: CommercialExtraction, snapshot: EvidenceSnapshot): GateResult {
  const offers = extraction.offers;
  const relevant = offers.filter((offer) => ACCEPTED_OFFER_TYPES.includes(offer.type));

  if (relevant.length === 0) {
    return {
      status: "fail",
      evidence: offers.flatMap((offer) => offer.evidence),
      reason:
        offers.length === 0
          ? "no offer found across the bio, Highlights, content, or linked pages"
          : "every offer is a disqualifying type (agency/affiliate/commerce/software/employment)",
    };
  }

  const paid = relevant.filter((offer) => offer.is_paid === "paid");

  /*
   * The spec's Gate 4 "Strong evidence" list (page 4) treats "Application
   * funnel" and "Book a consultation" as sufficient strong evidence in their
   * own right — not merely a stand-in for an undisclosed price. High-ticket
   * coaching funnels routinely withhold price until an application/booking
   * call by design; requiring is_paid confirmation alone sent leads with a
   * perfect 12/12 score and a live Calendly/application funnel to manual
   * review for no reason the spec actually supports. Checked independently
   * of `paid` — a relevant offer connected to a real application/booking
   * destination, OR whose own CTA text says so, counts on its own.
   */
  const strongFunnelEvidence =
    hasApplicationOrBookingFunnel(snapshot) ||
    relevant.some((offer) => offer.cta && APPLICATION_OR_BOOKING_CTA_PATTERN.test(offer.cta));

  const strongOffers = paid.length > 0 ? paid : strongFunnelEvidence ? relevant : [];

  if (strongOffers.length > 0) {
    /*
     * Strong offer evidence is still only as trustworthy as the funnel
     * evidence behind it. An extraction that reports the information_funnel
     * signal as `absent` — the surface WAS captured and there is no asset,
     * webinar, application, or delivery path found — undermines "this offer
     * is real" even when a price or application funnel is visible, so this
     * is uncertain rather than a pass. `unknown`/`conflicting` funnel states
     * do not downgrade the gate here: those are handled as a review-forcing
     * safety check in decide.ts, same principle as an unknown CTA signal.
     */
    if (extraction.information_funnel.state === "absent") {
      return {
        status: "uncertain",
        evidence: strongOffers.flatMap((offer) => offer.evidence),
        reason: `relevant offer(s) with strong evidence exist but information_funnel is absent — no funnel evidence to corroborate the offer: ${strongOffers.map((offer) => offer.name ?? offer.type).join(", ")}`,
      };
    }
    return {
      status: "pass",
      evidence: strongOffers.flatMap((offer) => offer.evidence),
      reason:
        paid.length > 0
          ? `relevant paid offer(s): ${paid.map((offer) => offer.name ?? offer.type).join(", ")}`
          : `relevant offer(s) with a confirmed application/booking funnel (strong evidence per the spec, even without confirmed pricing): ${relevant.map((offer) => offer.name ?? offer.type).join(", ")}`,
    };
  }

  /*
   * A relevant offer type exists but no offer is confirmed paid and there is
   * no application/booking funnel either — the spec's "weak evidence" bucket
   * (free course only, generic link, no identifiable paid offer). A guess in
   * either direction is wrong often enough that this goes to a human rather
   * than being asserted as free or paid.
   */
  return {
    status: "uncertain",
    evidence: relevant.flatMap((offer) => offer.evidence),
    reason: `relevant offer(s) exist but none confirmed paid, and no application/booking funnel was found: ${relevant
      .map((offer) => `${offer.name ?? offer.type}:${offer.is_paid ?? "unknown"}`)
      .join(", ")}`,
  };
}
