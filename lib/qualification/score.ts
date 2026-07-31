/*
 * Commercial-fit scoring.
 *
 * Pure label-to-point mapping under a versioned scorecard. The score explains
 * and ranks eligible leads; it never restores eligibility to a hard-excluded
 * one and never substitutes for a failed core gate.
 */

import type {
  CommercialExtraction,
  CommercialScores,
  EvidenceSnapshot,
  ScoreComponent,
} from "./types";
import { ACTIVE_SCORECARD, groupHighlights, type Scorecard } from "./scorecard";

export type ScoreResult = {
  scores: CommercialScores;
  components: Record<string, ScoreComponent>;
  scorecard_version: string;
};

export function scoreCommercialFit(
  extraction: CommercialExtraction,
  snapshot: EvidenceSnapshot,
  scorecard: Scorecard = ACTIVE_SCORECARD,
): ScoreResult {
  const highlights =
    snapshot.instagram.story_highlights_capture_status === "captured"
      ? groupHighlights(snapshot.instagram.story_highlight_titles)
      : { proof: 0, offer: 0, funnel: 0, authority: 0 };

  const buyer = mapLabel(
    "buyer_clarity",
    extraction.audience.label,
    scorecard.buyer_clarity,
    extraction.audience.evidence,
    extraction.audience.value ?? "no audience value returned",
  );

  const transformation = mapLabel(
    "transformation_clarity",
    extraction.transformation.label,
    scorecard.transformation_clarity,
    extraction.transformation.evidence,
    extraction.transformation.outcome ?? "no transformation outcome returned",
  );

  /*
   * Highlight bonuses are capped and only apply where the base label is already
   * below the cap. A folder titled RESULTS is supporting evidence; it must not
   * be able to manufacture a maximum score on its own.
   */
  const funnelBase = mapLabel(
    "information_funnel_evidence",
    extraction.information_funnel.label,
    scorecard.information_funnel_evidence,
    extraction.information_funnel.evidence,
    extraction.information_funnel.asset_or_offer ?? "no offer named",
  );
  const funnel = applyHighlightBonus(funnelBase, highlights.offer, scorecard, "offer Highlight");

  const conversionBase = mapLabel(
    "conversion_intent",
    extraction.cta.label,
    scorecard.conversion_intent,
    extraction.cta.evidence,
    extraction.cta.action ?? "no CTA action returned",
  );
  const conversion = applyHighlightBonus(
    conversionBase,
    highlights.funnel,
    scorecard,
    "funnel Highlight",
  );

  const proofBase = mapLabel(
    "proof_strength",
    extraction.proof.label,
    scorecard.proof_strength,
    extraction.proof.evidence,
    describeProof(extraction),
  );
  const proof = applyHighlightBonus(
    proofBase,
    highlights.proof,
    { ...scorecard, highlights: { ...scorecard.highlights, dimension_cap: 0.75 } },
    "proof Highlight",
  );

  const authority = mapLabel(
    "authority_strength",
    extraction.authority.label,
    scorecard.authority_strength,
    extraction.authority.evidence,
    extraction.authority.types.join(", ") || "no authority type returned",
  );

  const proofMaturity = round(proof.value + authority.value);
  const commercialFit = round(
    buyer.value + transformation.value + funnel.value + conversion.value + proofMaturity,
  );

  return {
    scorecard_version: scorecard.version,
    scores: {
      buyer_clarity: buyer.value,
      transformation_clarity: transformation.value,
      information_funnel_evidence: funnel.value,
      conversion_intent: conversion.value,
      proof_strength: proof.value,
      authority_strength: authority.value,
      proof_maturity: proofMaturity,
      commercial_fit: commercialFit,
    },
    components: {
      buyer_clarity: buyer,
      transformation_clarity: transformation,
      information_funnel_evidence: funnel,
      conversion_intent: conversion,
      proof_strength: proof,
      authority_strength: authority,
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
    // An unmapped label is a scorecard/extractor version mismatch, not a zero
    // to be silently scored. Surface it rather than quietly downgrading a lead.
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

function applyHighlightBonus(
  component: ScoreComponent,
  groupCount: number,
  scorecard: Scorecard,
  source: string,
): ScoreComponent {
  if (groupCount <= 0) return component;
  const cap = scorecard.highlights.dimension_cap;
  if (component.value >= cap) return component;

  const boosted = Math.min(cap, component.value + scorecard.highlights.per_group_bonus);
  if (boosted === component.value) return component;
  return {
    ...component,
    value: round(boosted),
    reason: `${component.reason}; +${round(boosted - component.value)} from ${source} (capped at ${cap})`,
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
