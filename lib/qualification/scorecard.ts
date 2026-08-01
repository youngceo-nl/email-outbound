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

export type Scorecard = {
  version: string;
  buyer_clarity: Record<string, number>;
  transformation_clarity: Record<string, number>;
  information_funnel_evidence: Record<string, number>;
  conversion_intent: Record<string, number>;
  proof_strength: Record<string, number>;
  authority_strength: Record<string, number>;
  thresholds: {
    qualified_min: number;
    review_min: number;
    review_max: number;
    rejected_max: number;
    auto_approve_min: number;
    min_information_funnel: number;
    min_conversion_intent: number;
  };
  highlights: {
    per_group_bonus: number;
    dimension_cap: number;
  };
  priority_weights: {
    commercial_fit: number;
    proof_maturity: number;
    reel_view_rate: number;
    posting_recency: number;
    posting_consistency: number;
  };
};

/*
 * The five anchored labels per dimension map to the spec's 0/0.5/1/1.5/2 ladder
 * by ordinal position. Proof and authority each contribute 0 to 1 and sum to
 * the 0 to 2 proof_maturity dimension; `credible` is 0.75 to reproduce the
 * worked example in the specification (2+2+1.5+2+0.75 = 8.25).
 */
export const ACTIVE_SCORECARD: Scorecard = {
  version: SCORECARD_VERSION,

  buyer_clarity: { none: 0, broad: 0.5, inferred: 1, specific: 1.5, explicit: 2 },
  transformation_clarity: {
    none: 0,
    inspirational: 0.5,
    expertise_only: 1,
    implied_result: 1.5,
    explicit_result: 2,
  },
  information_funnel_evidence: {
    none: 0,
    weak_education: 0.5,
    indirect_funnel: 1,
    visible_offer: 1.5,
    explicit_offer: 2,
  },
  conversion_intent: {
    none: 0,
    audience_only: 0.5,
    information_action: 1,
    commercial_action: 1.5,
    direct_sales_action: 2,
  },
  proof_strength: { absent: 0, weak: 0.35, credible: 0.75, strong: 1 },
  authority_strength: { absent: 0, weak: 0.35, credible: 0.75, strong: 1 },

  thresholds: {
    qualified_min: 8.0,
    review_min: 6.0,
    review_max: 7.5,
    rejected_max: 5.5,
    auto_approve_min: 8.0,
    min_information_funnel: 1.0,
    min_conversion_intent: 1.0,
  },

  highlights: {
    per_group_bonus: 0.5,
    dimension_cap: 1.5,
  },

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
  { group: "offer", pattern: /\b(1[\s-]?(?:on|to)?[\s-]?1|coaching|program|mentorship|work with me|academy|course|package)/i },
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
