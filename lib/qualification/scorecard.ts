/*
 * Versioned scorecard configuration.
 *
 * Label-to-point mappings and thresholds live here rather than inside the
 * scoring code so a stored extraction can be replayed under a new scorecard
 * without another model call. Changing any number in this file REQUIRES a new
 * `version` string, otherwise two decisions carrying the same version are not
 * comparable and the shadow benchmark silently compares different systems.
 */

import { SCORECARD_VERSION } from "@/lib/evidence/versions";

/*
 * Replaces the old 10-point / five-label-ladder scorecard with the "Revised
 * Instagram ICP Qualification Logic" spec's 0/1/2 six-dimension model
 * (0-12 total). This is a genuine replacement, not a shadow — the old
 * `buyer_clarity`/`information_funnel_evidence`/`authority_strength` fields
 * and the highlight-bonus mechanic are retired. `authority` is now Gate 2
 * evidence (lib/qualification/icp-gates.ts), not a scored dimension, and
 * highlights feed Funnel Maturity specifically via
 * lib/evidence/funnel-maturity.ts rather than a flat bonus added to every
 * dimension.
 *
 * Offer Clarity and Funnel Maturity are not simple label ladders — they are
 * composite/count-based scores computed directly in
 * lib/qualification/icp-score.ts — so they have no entry here.
 */
export type Scorecard = {
  version: string;
  ladders: {
    /** Keyed by BuyerClarityLabel: none/broad/inferred/specific/explicit. */
    audience_specificity: Record<string, number>;
    /** Keyed by TransformationLabel. */
    transformation_clarity: Record<string, number>;
    /** Keyed by ConversionIntentLabel; direct-response CTAs can still push this to 2. */
    conversion_path: Record<string, number>;
    /** Keyed by ProofLabel: absent/weak/credible/strong. */
    proof: Record<string, number>;
  };
  /** Present funnel_maturity_signals count -> points. See icp-score.ts. */
  funnel_maturity_thresholds: {
    /** At or above this count of present signals: 1 point. */
    one_point_min: number;
    /** At or above this count: 2 points. */
    two_point_min: number;
  };
  thresholds: {
    /** total_icp_score >= this -> QUALIFIED_HIGH_PRIORITY (spec: 10-12). */
    qualified_high_priority_min: number;
    /** total_icp_score >= this (and below the tier above) -> QUALIFIED (spec: 7-9). */
    qualified_min: number;
    /** total_icp_score >= this (and below the tier above) -> MANUAL_REVIEW (spec: 4-6). */
    manual_review_min: number;
    // Below manual_review_min -> REJECTED, subject to rejection confidence
    // (deriveRejectionConfidence in certainty.ts, unchanged).
  };
  priority_weights: {
    commercial_fit: number;
    proof_maturity: number;
    reel_view_rate: number;
    posting_recency: number;
    posting_consistency: number;
  };
};

export const ACTIVE_SCORECARD: Scorecard = {
  version: SCORECARD_VERSION,

  ladders: {
    audience_specificity: { none: 0, broad: 1, inferred: 1, specific: 2, explicit: 2 },
    transformation_clarity: {
      none: 0,
      inspirational: 1,
      expertise_only: 1,
      implied_result: 2,
      explicit_result: 2,
    },
    conversion_path: {
      none: 0,
      audience_only: 1,
      information_action: 1,
      commercial_action: 2,
      direct_sales_action: 2,
    },
    proof: { absent: 0, weak: 1, credible: 2, strong: 2 },
  },

  funnel_maturity_thresholds: {
    one_point_min: 1,
    two_point_min: 4,
  },

  thresholds: {
    qualified_high_priority_min: 10,
    qualified_min: 7,
    manual_review_min: 4,
  },

  // Key names unchanged from the old scorecard (commercial_fit/proof_maturity)
  // even though what feeds them changed — priority.ts now normalizes
  // total_icp_score/12 and the new proof dimension/2 into these same slots.
  priority_weights: {
    commercial_fit: 0.5,
    proof_maturity: 0.15,
    reel_view_rate: 0.15,
    posting_recency: 0.1,
    posting_consistency: 0.1,
  },
};

/*
 * Story Highlight titles group semantically, not by exact string match:
 * TRANSFORMATIONS and SUCCESS STORIES belong to Proof even though neither is a
 * literal entry in the spec's example table.
 */
export type HighlightGroup = "proof" | "offer" | "funnel" | "authority";

const HIGHLIGHT_PATTERNS: Array<{ group: HighlightGroup; pattern: RegExp }> = [
  /*
   * `student` and `member` sit alongside `client` deliberately. The spec lists
   * STUDENT WINS under Proof and says matching is semantic, but the pattern
   * previously matched `client` only — so a "CLIENTS" folder scored as proof
   * while a "STUDENTS" folder scored as nothing. For an information ICP that is
   * backwards: students are the more on-target outcome evidence.
   */
  { group: "proof", pattern: /\b(result|client|student|member|review|win|testimonial|transformation|case stud|success stor|before.?after)/i },
  /*
   * `consulting` and `mastermind` were missing even though the spec lists both
   * explicitly (§5, High-value Highlight categories > Offer) — a folder titled
   * CONSULTING or MASTERMIND matched nothing before this.
   */
  { group: "offer", pattern: /\b(1[\s-]?(?:on|to)?[\s-]?1|coaching|consulting|program|mentorship|mastermind|work with me|academy|course|package)/i },
  { group: "funnel", pattern: /\b(start here|free|apply|book|join|call|link|training|webinar|blueprint|roadmap|guide)/i },
  { group: "authority", pattern: /\b(my story|about me|journey|youtube|podcast|press|featured|media)/i },
];

export function classifyHighlight(title: string): HighlightGroup | null {
  const normalized = title
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const { group, pattern } of HIGHLIGHT_PATTERNS) {
    if (pattern.test(normalized)) return group;
  }
  return null;
}

export function groupHighlights(titles: readonly string[]): Record<HighlightGroup, number> {
  const counts: Record<HighlightGroup, number> = { proof: 0, offer: 0, funnel: 0, authority: 0 };
  for (const title of titles) {
    const group = classifyHighlight(title);
    if (group) counts[group] += 1;
  }
  return counts;
}
