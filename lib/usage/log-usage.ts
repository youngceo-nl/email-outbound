import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeTokenCost } from "./token-pricing";

export type UsageProvider = "openai" | "claude" | "scrapingbee" | "apify";

export type UsageEvent = {
  provider: UsageProvider;
  operation: string;
  model?: string | null;
  leadId?: string | null;
  quantity?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd: number;
  estimated?: boolean;
};

// Best-effort insert. Billing instrumentation must NEVER break the pipeline it
// is measuring, so every failure is swallowed (and logged to the console).
export async function logApiUsage(event: UsageEvent): Promise<void> {
  try {
    const sb = createAdminClient();
    await sb.from("api_usage_events").insert({
      provider: event.provider,
      operation: event.operation,
      model: event.model ?? null,
      lead_id: event.leadId ?? null,
      quantity: event.quantity ?? null,
      input_tokens: event.inputTokens ?? null,
      output_tokens: event.outputTokens ?? null,
      cost_usd: Number(event.costUsd.toFixed(6)),
      estimated: event.estimated ?? false,
    });
  } catch (err) {
    console.error("[billing] failed to log api usage:", (err as Error).message);
  }
}

// Convenience wrapper for LLM token usage — computes the cost from list pricing.
export async function logLlmUsage(opts: {
  provider: "openai" | "claude";
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  leadId?: string | null;
}): Promise<void> {
  const costUsd = computeTokenCost(opts.provider, opts.model, opts.inputTokens, opts.outputTokens);
  await logApiUsage({
    provider: opts.provider,
    operation: opts.operation,
    model: opts.model,
    leadId: opts.leadId ?? null,
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    costUsd,
    estimated: true,
  });
}
