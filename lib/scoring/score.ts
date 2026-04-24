import "server-only";
import { classifyWithOpenAi } from "@/lib/openai/classify";
import { classifyWithClaude } from "@/lib/claude/classify";
import { logLlmUsage } from "@/lib/usage/log-usage";
import { computeScores } from "./compute";
import type { AppSettings, ClaudeScore, ScrapedProfile } from "@/lib/types";
import type { ComputedMetrics } from "@/lib/pipeline/metrics";

// AI handles ONLY classification (niche / business model / offer type).
// All numeric scoring is computed deterministically in `computeScores`.
// Result is the same ClaudeScore shape callers already expect.
export async function scoreProfileRouted(opts: {
  settings: AppSettings;
  profile: ScrapedProfile;
  metrics: ComputedMetrics;
}): Promise<{ score: ClaudeScore; provider: "openai" | "claude" }> {
  const { settings, profile, metrics } = opts;
  const provider = settings.scoring_provider; // "openai" | "claude"

  if (provider === "openai") {
    const apiKey = settings.openai_api_key || process.env.OPENAI_API_KEY || "";
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured (set in Settings or env)");
    const model = settings.openai_model || "gpt-4o-mini";
    const { classification, usage } = await classifyWithOpenAi({ apiKey, model, profile });
    await logLlmUsage({
      provider: "openai",
      model,
      operation: "profile_score",
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    const score = computeScores({ profile, metrics, classification, settings });
    return { score, provider: "openai" };
  }

  const apiKey = settings.claude_api_key || process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured (set in Settings or env)");
  const { classification, usage } = await classifyWithClaude({
    apiKey,
    model: settings.claude_model,
    profile,
  });
  await logLlmUsage({
    provider: "claude",
    model: settings.claude_model,
    operation: "profile_score",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
  const score = computeScores({ profile, metrics, classification, settings });
  return { score, provider: "claude" };
}
