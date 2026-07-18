import "server-only";
import type { ProviderStatus } from "./types";

type ApifyMe = {
  data?: {
    plan?: { id?: string; description?: string };
    usageCycle?: {
      usage?: { ACTOR_COMPUTE_UNITS?: number; "ACTOR_COMPUTE_UNITS_USD"?: number };
      limits?: { monthlyUsageUsd?: number };
    };
    limits?: { monthlyUsageUsd?: number };
    monthlyUsage?: { actorComputeUnits?: number; usageUsd?: number };
  };
};

export async function fetchApifyUsage(token: string): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    id: "apify",
    name: "Apify",
    configured: !!token,
    live: false,
    plan: null,
    used: null,
    total: null,
    unit: "USD this month",
    note: null,
    error: null,
    fetchedAt: new Date().toISOString(),
  };
  if (!token) return { ...base, note: "API key not set" };

  try {
    const res = await fetch("https://api.apify.com/v2/users/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ...base, error: `Apify ${res.status}: ${(await res.text()).slice(0, 120)}` };
    }
    const json = (await res.json()) as ApifyMe;
    const plan = json.data?.plan?.description ?? json.data?.plan?.id ?? null;
    const used = json.data?.monthlyUsage?.usageUsd ?? null;
    const total = json.data?.limits?.monthlyUsageUsd ?? json.data?.usageCycle?.limits?.monthlyUsageUsd ?? null;
    return {
      ...base,
      live: true,
      plan,
      used: used ?? null,
      total: total ?? null,
    };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}
