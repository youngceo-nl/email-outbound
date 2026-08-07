/*
 * The 12-point, six-dimension scorer from "Revised Instagram ICP
 * Qualification Logic". Pure label/count-to-point mapping under the
 * versioned scorecard — same principle as the retired score.ts: an unmapped
 * label surfaces as an explicit scorecard/extractor version mismatch rather
 * than quietly scoring 0.
 *
 * Runs only after icp-gates.ts resolves to "score" — a lead that failed or
 * was sent to review by a gate never reaches this file for the purpose of
 * deciding its outcome. It is still called unconditionally by decide.ts for
 * EVERY outcome, gated or not, because a score computed from already-
 * extracted facts costs nothing and the pipeline has always preserved scores
 * for analysis even on leads a gate rejected — see decide.ts's own header.
 */

import type {
  CommercialExtraction,
  EvidenceSnapshot,
  IcpScores,
  ScoreComponent,
} from "./types";
import { ACTIVE_SCORECARD, type Scorecard } from "./scorecard";

export type IcpScoreResult = {
  scores: IcpScores;
  components: Record<string, ScoreComponent>;
  scorecard_version: string;
};

export function scoreIcpFit(
  extraction: CommercialExtraction,
  snapshot: EvidenceSnapshot,
  scorecard: Scorecard = ACTIVE_SCORECARD,
): IcpScoreResult {
  const audience = mapLabel(
    "audience_specificity",
    extraction.audience.label,
    scorecard.ladders.audience_specificity,
    extraction.audience.evidence,
    extraction.audience.value ?? "no audience value returned",
  );

  const transformation = mapLabel(
    "transformation_clarity",
    extraction.transformation.label,
    scorecard.ladders.transformation_clarity,
    extraction.transformation.evidence,
    extraction.transformation.outcome ?? "no transformation outcome returned",
  );

  const proof = mapLabel(
    "proof",
    extraction.proof.label,
    scorecard.ladders.proof,
    extraction.proof.evidence,
    describeProof(extraction),
  );

  const conversionBase = mapLabel(
    "conversion_path",
    extraction.cta.label,
    scorecard.ladders.conversion_path,
    extraction.cta.evidence,
    extraction.cta.action ?? "no CTA action returned",
  );
  const conversion = boostForDirectResponse(conversionBase, snapshot);

  const offerClarity = scoreOfferClarity(extraction);
  const funnelMaturity = scoreFunnelMaturity(snapshot, scorecard);

  const total = round(
    audience.value +
      transformation.value +
      offerClarity.value +
      conversion.value +
      proof.value +
      funnelMaturity.value,
  );

  return {
    scorecard_version: scorecard.version,
    scores: {
      audience_specificity: audience.value,
      transformation_clarity: transformation.value,
      offer_clarity: offerClarity.value,
      conversion_path: conversion.value,
      proof: proof.value,
      funnel_maturity: funnelMaturity.value,
      total_icp_score: total,
    },
    components: {
      audience_specificity: audience,
      transformation_clarity: transformation,
      offer_clarity: offerClarity,
      conversion_path: conversion,
      proof,
      funnel_maturity: funnelMaturity,
    },
  };
}

function mapLabel(
  dimension: string,
  label: string,
  mapping: Record<string, number>,
  citations: ScoreComponent["citations"],
  detail: string,
): ScoreComponent {
  const value = mapping[label];
  if (value === undefined) {
    return {
      value: 0,
      label,
      reason: `unmapped label "${label}" for ${dimension} under this scorecard`,
      citations,
    };
  }
  return {
    value,
    label,
    reason: `${dimension}=${label} -> ${value} (${detail})`,
    citations,
  };
}

/*
 * "DM [keyword]" / "comment [keyword]" instructions are the spec's own
 * Dimension 4 examples for the top 2-point band. They are detected
 * deterministically (lib/evidence/cta-signals.ts) rather than relying on the
 * extractor's label alone, same rationale as the pipeline's existing
 * direct-response-CTA handling.
 */
function boostForDirectResponse(component: ScoreComponent, snapshot: EvidenceSnapshot): ScoreComponent {
  if (component.value >= 2) return component;
  if (snapshot.direct_response_ctas.length === 0) return component;
  const keywords = snapshot.direct_response_ctas.map((cta) => `${cta.action}:${cta.keyword ?? ""}`).join(", ");
  return {
    ...component,
    value: 2,
    reason: `${component.reason}; boosted to 2 by a detected direct-response CTA (${keywords})`,
  };
}

function describeProof(extraction: CommercialExtraction): string {
  const claims = [...extraction.proof.claims, ...extraction.proof_attribution];
  if (claims.length === 0) return "no proof claims";
  return claims
    .slice(0, 3)
    .map((claim) => `${claim.claim} (${claim.beneficiary})`)
    .join("; ");
}

/*
 * Not a label ladder — the spec's Offer Clarity requires "the offer type,
 * target buyer, and intended result" together for full marks, which is a
 * composite over the primary offer's populated fields, not a single
 * extractor-returned label.
 */
function scoreOfferClarity(extraction: CommercialExtraction): ScoreComponent {
  const primary =
    extraction.offers.find((offer) => offer.prominence === "primary") ?? extraction.offers[0];

  if (!primary) {
    return { value: 0, label: "none", reason: "no offer to evaluate for clarity", citations: [] };
  }

  const hasAudience = Boolean(primary.audience);
  const hasResultOrDelivery = Boolean(primary.delivery || primary.cta);
  const hasName = Boolean(primary.name);

  if (hasAudience && hasResultOrDelivery) {
    return {
      value: 2,
      label: "clear",
      reason: `offer type, target buyer, and intended result all specified: ${primary.name ?? primary.type}`,
      citations: primary.evidence,
    };
  }
  if (hasAudience || hasResultOrDelivery || hasName) {
    return {
      value: 1,
      label: "partial",
      reason: `a ${primary.type} offer is visible but details are limited: ${primary.name ?? primary.type}`,
      citations: primary.evidence,
    };
  }
  return {
    value: 0,
    label: "unclear",
    reason: "the offer technically exists but its format is almost impossible to understand",
    citations: primary.evidence,
  };
}

/*
 * Also not a label ladder — counts `present` entries in the deterministic
 * funnel_maturity_signals inventory (lib/evidence/funnel-maturity.ts), built
 * from data already in the snapshot. Absent when the snapshot predates that
 * field (older acquisition_version), which scores 0 rather than throwing.
 */
function scoreFunnelMaturity(snapshot: EvidenceSnapshot, scorecard: Scorecard): ScoreComponent {
  const signals = snapshot.funnel_maturity_signals ?? [];
  const present = signals.filter((signal) => signal.present);
  const count = present.length;
  const evidence = present.flatMap((signal) => signal.evidence);

  const value =
    count >= scorecard.funnel_maturity_thresholds.two_point_min
      ? 2
      : count >= scorecard.funnel_maturity_thresholds.one_point_min
        ? 1
        : 0;

  return {
    value,
    label: `${count}_signals_present`,
    reason: `${count} funnel-maturity signal(s) present: ${present.map((signal) => signal.kind).join(", ") || "none"}`,
    citations: evidence,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
