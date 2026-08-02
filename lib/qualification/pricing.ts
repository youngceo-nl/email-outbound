/*
 * Per-model token pricing for qualification runs.
 *
 * The extractor runs on Haiku and the challenger on Opus — a 5x difference on
 * both input and output. Reporting a single blended token total is what hid the
 * fact that the challenger, firing on a minority of leads, was the majority of
 * the spend. Costs are therefore always computed per model and summed, never
 * from a pooled token count.
 *
 * An unknown model yields `null` rather than 0. A confident $0.00 next to real
 * spend is worse than an admission that we cannot price it.
 *
 * No `server-only` import: this must run under `tsx` for the CLI and tests,
 * same rationale as lib/qualification/repository.ts.
 */

export type ModelPrice = {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
};

/*
 * Anthropic list prices. Update alongside any model change in
 * scripts/qualify-profiles.ts — an unlisted model degrades to "cost unknown",
 * which is visible in the UI rather than silently wrong.
 */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
};

export type UsageEntry = {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
};

export type CostEstimate = {
  /** null when any entry's model has no published price — see `unpriced`. */
  usd: number | null;
  /** Model names we could not price, for display alongside the null. */
  unpriced: string[];
};

const MILLION = 1_000_000;

/**
 * Sums cost across usage entries, each priced at its own model's rate.
 * Entries with zero tokens are ignored, so an unpriced model that never
 * actually ran does not poison the estimate.
 */
export function estimateCostUsd(entries: readonly UsageEntry[]): CostEstimate {
  let usd = 0;
  const unpriced = new Set<string>();

  for (const entry of entries) {
    if (entry.inputTokens <= 0 && entry.outputTokens <= 0) continue;

    const price = entry.model ? MODEL_PRICING[entry.model] : undefined;
    if (!price) {
      unpriced.add(entry.model ?? "(unknown model)");
      continue;
    }

    usd +=
      (entry.inputTokens / MILLION) * price.inputPerMTok +
      (entry.outputTokens / MILLION) * price.outputPerMTok;
  }

  if (unpriced.size > 0) return { usd: null, unpriced: [...unpriced] };
  return { usd: Number(usd.toFixed(6)), unpriced: [] };
}

/** Formats an estimate for display, preserving the unknown case. */
export function formatCostUsd(estimate: CostEstimate): string {
  if (estimate.usd === null) {
    return `cost unknown (${estimate.unpriced.join(", ")})`;
  }
  if (estimate.usd === 0) return "$0.00";
  if (estimate.usd < 0.01) return `<$0.01`;
  return `$${estimate.usd.toFixed(2)}`;
}
