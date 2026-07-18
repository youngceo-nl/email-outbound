import "server-only";
import type { ProviderStatus } from "./types";

export function buildClaudeStatus(apiKey: string, model: string): ProviderStatus {
  return {
    id: "claude",
    name: "Anthropic Claude",
    configured: !!apiKey,
    live: false,
    plan: model || null,
    used: null,
    total: null,
    unit: "USD this month",
    note: apiKey ? "Anthropic usage is on console.anthropic.com." : "API key not set",
    error: null,
    fetchedAt: new Date().toISOString(),
  };
}
