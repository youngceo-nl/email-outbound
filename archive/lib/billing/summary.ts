import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllUsage } from "@/lib/usage/aggregate";

export type SpendKind = "metered" | "live" | "fixed";

export type SpendRow = {
  id: string;
  label: string;
  kind: SpendKind;
  // Dollar amount counted toward the monthly total. null means we have a usage
  // signal but no reliable dollar conversion (shown as info only).
  monthUsd: number | null;
  estimated: boolean;
  note: string | null;
};

export type FixedCost = {
  id: string;
  label: string;
  monthly_usd: number;
  note: string | null;
  active: boolean;
};

export type DailyPoint = { date: string; usd: number };

export type RecentEvent = {
  id: string;
  provider: string;
  operation: string;
  model: string | null;
  costUsd: number;
  estimated: boolean;
  createdAt: string;
};

export type BillingSummary = {
  monthLabel: string;
  daysInMonth: number;
  dayOfMonth: number;
  elapsedFraction: number;
  meteredMonthUsd: number;
  liveMonthUsd: number;
  fixedMonthlyUsd: number;
  totalMonthUsd: number;
  projectedMonthUsd: number;
  allTimeUsd: number;
  rows: SpendRow[];
  fixedCosts: FixedCost[];
  daily: DailyPoint[];
  recent: RecentEvent[];
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  claude: "Anthropic Claude",
  airscale: "AirScale",
  scrapingbee: "ScrapingBee",
  apify: "Apify",
};

function monthBounds(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const daysInMonth = Math.round((nextStart.getTime() - start.getTime()) / 86_400_000);
  const elapsedMs = now.getTime() - start.getTime();
  const totalMs = nextStart.getTime() - start.getTime();
  return {
    start,
    nextStart,
    daysInMonth,
    dayOfMonth: now.getUTCDate(),
    elapsedFraction: Math.min(1, Math.max(elapsedMs / totalMs, 0.0001)),
    label: start.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export async function getBillingSummary(): Promise<BillingSummary> {
  const sb = createAdminClient();
  const now = new Date();
  const m = monthBounds(now);

  const [monthRes, allTimeRes, fixedRes, usageStatuses] = await Promise.all([
    sb
      .from("api_usage_events")
      .select("id, provider, operation, model, cost_usd, estimated, created_at")
      .gte("created_at", m.start.toISOString())
      .order("created_at", { ascending: false }),
    sb.from("api_usage_events").select("cost_usd"),
    sb.from("fixed_costs").select("*").order("created_at", { ascending: true }),
    fetchAllUsage().catch(() => []),
  ]);

  const monthRows = (monthRes.data ?? []) as Array<{
    id: string;
    provider: string;
    operation: string;
    model: string | null;
    cost_usd: number;
    estimated: boolean;
    created_at: string;
  }>;

  // --- Metered spend this month, grouped by provider ---
  const byProvider = new Map<string, { usd: number; estimated: boolean }>();
  for (const r of monthRows) {
    const cur = byProvider.get(r.provider) ?? { usd: 0, estimated: false };
    cur.usd += Number(r.cost_usd) || 0;
    cur.estimated = cur.estimated || r.estimated;
    byProvider.set(r.provider, cur);
  }

  const rows: SpendRow[] = [];
  let meteredMonthUsd = 0;
  for (const [provider, agg] of byProvider) {
    meteredMonthUsd += agg.usd;
    rows.push({
      id: `metered:${provider}`,
      label: PROVIDER_LABELS[provider] ?? provider,
      kind: "metered",
      monthUsd: agg.usd,
      estimated: agg.estimated,
      note: agg.estimated ? "estimated from list pricing" : null,
    });
  }

  // --- Live provider balances (Apify reports USD this month directly) ---
  let liveMonthUsd = 0;
  for (const s of usageStatuses) {
    if (s.id === "apify" && s.live && typeof s.used === "number") {
      liveMonthUsd += s.used;
      rows.push({
        id: "live:apify",
        label: "Apify",
        kind: "live",
        monthUsd: s.used,
        estimated: false,
        note: s.plan ? `live · ${s.plan}` : "live balance",
      });
    }
    if (s.id === "scrapingbee" && s.live && typeof s.used === "number") {
      // ScrapingBee meters credits, not dollars — show as info only, don't add
      // to the dollar total (no reliable per-credit price without the plan).
      rows.push({
        id: "live:scrapingbee",
        label: "ScrapingBee",
        kind: "live",
        monthUsd: null,
        estimated: false,
        note: `${Math.round(s.used).toLocaleString()} credits used${s.total ? ` / ${Math.round(s.total).toLocaleString()}` : ""}`,
      });
    }
  }

  // --- Fixed monthly subscriptions ---
  const fixedCosts = ((fixedRes.data ?? []) as FixedCost[]).map((f) => ({
    ...f,
    monthly_usd: Number(f.monthly_usd) || 0,
  }));
  let fixedMonthlyUsd = 0;
  for (const f of fixedCosts) {
    if (!f.active) continue;
    fixedMonthlyUsd += f.monthly_usd;
    rows.push({
      id: `fixed:${f.id}`,
      label: f.label,
      kind: "fixed",
      monthUsd: f.monthly_usd,
      estimated: false,
      note: f.note ?? "fixed monthly",
    });
  }

  rows.sort((a, b) => (b.monthUsd ?? 0) - (a.monthUsd ?? 0));

  const totalMonthUsd = meteredMonthUsd + liveMonthUsd + fixedMonthlyUsd;
  // Project metered + live usage to month-end at the current daily pace; fixed
  // costs are already the full-month figure.
  const projectedVariable = (meteredMonthUsd + liveMonthUsd) / m.elapsedFraction;
  const projectedMonthUsd = projectedVariable + fixedMonthlyUsd;

  const allTimeMetered = ((allTimeRes.data ?? []) as Array<{ cost_usd: number }>).reduce(
    (sum, r) => sum + (Number(r.cost_usd) || 0),
    0,
  );

  // --- Daily series for the current month (metered only) ---
  const dailyMap = new Map<string, number>();
  for (const r of monthRows) {
    const day = r.created_at.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + (Number(r.cost_usd) || 0));
  }
  const daily: DailyPoint[] = [];
  for (let d = 1; d <= m.dayOfMonth; d++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d))
      .toISOString()
      .slice(0, 10);
    daily.push({ date, usd: dailyMap.get(date) ?? 0 });
  }

  const recent: RecentEvent[] = monthRows.slice(0, 15).map((r) => ({
    id: r.id,
    provider: PROVIDER_LABELS[r.provider] ?? r.provider,
    operation: r.operation,
    model: r.model,
    costUsd: Number(r.cost_usd) || 0,
    estimated: r.estimated,
    createdAt: r.created_at,
  }));

  return {
    monthLabel: m.label,
    daysInMonth: m.daysInMonth,
    dayOfMonth: m.dayOfMonth,
    elapsedFraction: m.elapsedFraction,
    meteredMonthUsd,
    liveMonthUsd,
    fixedMonthlyUsd,
    totalMonthUsd,
    projectedMonthUsd,
    allTimeUsd: allTimeMetered,
    rows,
    fixedCosts,
    daily,
    recent,
  };
}
