import "server-only";
import type { ProviderStatus } from "./types";

export function buildAirscaleStatus(apiKey: string): ProviderStatus {
  return {
    id: "airscale",
    name: "AirScale",
    configured: !!apiKey,
    live: false,
    plan: null,
    used: null,
    total: null,
    unit: "email lookups",
    note: apiKey ? "AirScale doesn't expose live usage — see dashboard." : "API key not set",
    error: null,
    fetchedAt: new Date().toISOString(),
  };
}
