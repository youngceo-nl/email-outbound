import "server-only";
import type { ProviderStatus } from "./types";

export function buildOpenAiStatus(apiKey: string, model: string): ProviderStatus {
  return {
    id: "openai",
    name: "OpenAI",
    configured: !!apiKey,
    live: false,
    plan: model || null,
    used: null,
    total: null,
    unit: "USD this month",
    note: apiKey ? "OpenAI usage is on platform.openai.com/usage." : "API key not set",
    error: null,
    fetchedAt: new Date().toISOString(),
  };
}
