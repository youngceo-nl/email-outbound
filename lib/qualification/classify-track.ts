/*
 * Deterministic track classification.
 *
 * Derived from the extracted business models, the primary visitor outcome, and
 * offer prominence — never from the words "coach" or "agency" appearing in a
 * bio. A profile that calls itself an agency but whose visitor ultimately
 * receives coaching is an information brand; a profile that calls itself a coach
 * but whose visitor ultimately receives done-for-you delivery is not.
 */

import type {
  BusinessModelFact,
  CommercialExtraction,
  CommercialTrack,
  OfferEvidence,
  VisitorOutcome,
} from "./types";
import { INFORMATION_VISITOR_OUTCOMES } from "./types";

export type TrackClassification = {
  track: CommercialTrack;
  reason: string;
  /** Both an agency path and an information path look similarly prominent. */
  mixed: boolean;
  primary_visitor_outcome: VisitorOutcome | null;
};

const MODEL_TO_TRACK: Record<string, CommercialTrack> = {
  information_education: "information_personal_brand",
  agency_service: "agency_service",
  commerce: "commerce",
  saas: "saas",
  affiliate: "affiliate",
  employment: "employment",
  non_commercial: "non_commercial",
};

const OUTCOME_TO_TRACK: Partial<Record<VisitorOutcome, CommercialTrack>> = {
  done_for_you_service: "agency_service",
  recruiting_service: "agency_service",
  employment_opportunity: "employment",
  affiliate_offer: "affiliate",
  commerce_product: "commerce",
  software: "saas",
  managed_trading: "agency_service",
  signals_service: "agency_service",
  entertainment: "non_commercial",
};

export function classifyTrack(extraction: CommercialExtraction): TrackClassification {
  const outcome = extraction.primary_visitor_outcome;
  const primaries = extraction.business_models.filter((model) => model.prominence === "primary");

  /*
   * A human personal brand is a prerequisite for the ICP. Without it the
   * profile cannot be an information personal brand no matter how strong the
   * funnel looks — a company account selling courses is a different lead type.
   */
  const humanBrand = extraction.human_personal_brand.state;

  // ---- Mixed evidence outranks any single reading. ----
  const hasAgencyPrimary = primaries.some((model) => model.type === "agency_service");
  const hasInfoPrimary = primaries.some((model) => model.type === "information_education");

  if (hasAgencyPrimary && hasInfoPrimary) {
    return {
      track: "uncertain",
      reason: "agency service and information offer are both primary",
      mixed: true,
      primary_visitor_outcome: outcome,
    };
  }
  if (extraction.conflicts.length > 0 && !outcome) {
    return {
      track: "uncertain",
      reason: `unresolved conflicts: ${extraction.conflicts.slice(0, 2).join("; ")}`,
      mixed: true,
      primary_visitor_outcome: outcome,
    };
  }

  /*
   * The visitor outcome is the strongest single signal because it describes
   * what actually happens after conversion, which is what the spec's whole
   * agency exclusion turns on.
   */
  if (outcome) {
    const outcomeTrack = OUTCOME_TO_TRACK[outcome];
    if (outcomeTrack) {
      return {
        track: outcomeTrack,
        reason: `primary visitor outcome is ${outcome}`,
        mixed: hasInfoPrimary,
        primary_visitor_outcome: outcome,
      };
    }
    if (INFORMATION_VISITOR_OUTCOMES.includes(outcome)) {
      if (humanBrand === "present") {
        return {
          track: "information_personal_brand",
          reason: `human personal brand with primary visitor outcome ${outcome}`,
          mixed: false,
          primary_visitor_outcome: outcome,
        };
      }
      if (humanBrand === "absent") {
        return {
          track: "non_commercial",
          reason: "information outcome without a human personal brand",
          mixed: false,
          primary_visitor_outcome: outcome,
        };
      }
      return {
        track: "uncertain",
        reason: "information outcome but personal-brand identity is unknown",
        mixed: false,
        primary_visitor_outcome: outcome,
      };
    }
  }

  // ---- Fall back to the declared primary business model. ----
  if (primaries.length === 1) {
    const track = MODEL_TO_TRACK[primaries[0].type];
    if (track === "information_personal_brand" && humanBrand !== "present") {
      return {
        track: "uncertain",
        reason: "information model without confirmed personal-brand identity",
        mixed: false,
        primary_visitor_outcome: outcome,
      };
    }
    if (track) {
      return {
        track,
        reason: `single primary business model: ${primaries[0].type}`,
        mixed: false,
        primary_visitor_outcome: outcome,
      };
    }
  }
  if (primaries.length > 1) {
    return {
      track: "uncertain",
      reason: `multiple primary business models: ${primaries.map((m) => m.type).join(", ")}`,
      mixed: true,
      primary_visitor_outcome: outcome,
    };
  }

  return {
    track: "uncertain",
    reason: "no primary business model or visitor outcome could be established",
    mixed: false,
    primary_visitor_outcome: outcome,
  };
}

/** Offers whose visitor genuinely receives knowledge rather than delivered work. */
export function informationOffers(offers: readonly OfferEvidence[]): OfferEvidence[] {
  return offers.filter((offer) => {
    if (offer.type === "done_for_you_service" || offer.type === "employment") return false;
    if (offer.customer_implementation_role === "team_implemented") return false;
    if (offer.visitor_receives.length === 0) return false;
    return offer.visitor_receives.every((outcome) =>
      INFORMATION_VISITOR_OUTCOMES.includes(outcome),
    );
  });
}

export function primaryModels(models: readonly BusinessModelFact[]): BusinessModelFact[] {
  return models.filter((model) => model.prominence === "primary");
}
