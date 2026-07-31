/*
 * Priority scoring.
 *
 * Runs only after qualification and can never change it. Unknown activity
 * metrics contribute no penalty — they redistribute weight onto the components
 * we actually measured, so a lead with a broken post sample is not quietly
 * ranked below an identical lead whose scrape happened to succeed.
 */

import type { ActivityMetrics, CommercialScores, PriorityScore } from "./types";
import { ACTIVE_SCORECARD, type Scorecard } from "./scorecard";

export function computePriority(
  scores: CommercialScores,
  activity: ActivityMetrics,
  scorecard: Scorecard = ACTIVE_SCORECARD,
): PriorityScore {
  const weights = scorecard.priority_weights;

  // Each component is normalized to 0..1 before weighting.
  const commercialFit = clamp01(scores.commercial_fit / 10);
  const proofMaturity = clamp01(scores.proof_maturity / 2);

  const reelViewRate =
    activity.reel_view_rate === null ? null : clamp01(activity.reel_view_rate / 0.5);

  const postingRecency =
    activity.days_since_latest_post === null
      ? null
      : clamp01(1 - activity.days_since_latest_post / 60);

  const postingConsistency =
    activity.posts_last_30_days === null ? null : clamp01(activity.posts_last_30_days / 12);

  const parts: Array<{ value: number | null; weight: number }> = [
    { value: commercialFit, weight: weights.commercial_fit },
    { value: proofMaturity, weight: weights.proof_maturity },
    { value: reelViewRate, weight: weights.reel_view_rate },
    { value: postingRecency, weight: weights.posting_recency },
    { value: postingConsistency, weight: weights.posting_consistency },
  ];

  const known = parts.filter((part) => part.value !== null);
  const totalWeight = known.reduce((sum, part) => sum + part.weight, 0);
  const weighted = known.reduce((sum, part) => sum + (part.value as number) * part.weight, 0);

  // Renormalizing over known weights is what keeps a missing metric neutral
  // instead of implicitly scoring it as zero.
  const value = totalWeight > 0 ? round((weighted / totalWeight) * 10) : 0;

  const unknownCount = parts.length - known.length;
  const completeness: PriorityScore["data_completeness"] =
    unknownCount === 0 ? "complete" : unknownCount <= 2 ? "partial" : "unknown";

  return {
    value,
    data_completeness: completeness,
    components: {
      commercial_fit: round(commercialFit),
      proof_maturity: round(proofMaturity),
      reel_view_rate: reelViewRate === null ? null : round(reelViewRate),
      posting_recency: postingRecency === null ? null : round(postingRecency),
      posting_consistency: postingConsistency === null ? null : round(postingConsistency),
    },
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
