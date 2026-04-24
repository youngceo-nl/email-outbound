import "server-only";
import type { ProviderStatus } from "./types";

type SbUsage = {
  max_api_credits?: number;
  used_api_credits?: number;
  max_concurrency?: number;
  current_concurrency?: number;
  plan_name?: string;
};

export async function fetchScrapingBeeUsage(apiKey: string): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    id: "scrapingbee",
    name: "ScrapingBee",
    configured: !!apiKey,
    live: false,
    plan: null,
    used: null,
    total: null,
    unit: "API credits",
    note: null,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
  if (!apiKey) return { ...base, note: "API key not set" };

  try {
    const res = await fetch(`https://app.scrapingbee.com/api/v1/usage?api_key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ...base, error: `ScrapingBee ${res.status}: ${(await res.text()).slice(0, 120)}` };
    }
    const json = (await res.json()) as SbUsage;
    return {
      ...base,
      live: true,
      plan: json.plan_name ?? null,
      used: json.used_api_credits ?? null,
      total: json.max_api_credits ?? null,
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}
