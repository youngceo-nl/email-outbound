import "server-only";

// Per-1M-token list prices (USD). Used to turn logged token counts into a dollar
// cost on the Billing tab. Keep these in sync with the providers' pricing pages —
// they are the published list rates, so the computed spend is an estimate that
// should track your real invoice closely for these metered calls.

export type TokenRate = { inputPer1M: number; outputPer1M: number };

const OPENAI_RATES: Record<string, TokenRate> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1": { inputPer1M: 2.0, outputPer1M: 8.0 },
};

const CLAUDE_RATES: Record<string, TokenRate> = {
  haiku: { inputPer1M: 1, outputPer1M: 5 },
  sonnet: { inputPer1M: 3, outputPer1M: 15 },
  opus: { inputPer1M: 15, outputPer1M: 75 },
};

function openAiRate(model: string): TokenRate {
  const m = model.toLowerCase();
  for (const key of Object.keys(OPENAI_RATES)) {
    if (m.includes(key)) return OPENAI_RATES[key];
  }
  return OPENAI_RATES["gpt-4o-mini"]; // safe cheap default
}

function claudeRate(model: string): TokenRate {
  const m = model.toLowerCase();
  if (m.includes("haiku")) return CLAUDE_RATES.haiku;
  if (m.includes("opus")) return CLAUDE_RATES.opus;
  return CLAUDE_RATES.sonnet; // sonnet is the sensible mid default
}

export function tokenRate(provider: "openai" | "claude", model: string): TokenRate {
  return provider === "openai" ? openAiRate(model) : claudeRate(model);
}

export function computeTokenCost(
  provider: "openai" | "claude",
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = tokenRate(provider, model);
  return (inputTokens / 1_000_000) * rate.inputPer1M + (outputTokens / 1_000_000) * rate.outputPer1M;
}
