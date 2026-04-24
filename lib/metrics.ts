import type { SupabaseClient } from "@supabase/supabase-js";

export type MetricKey = "scraped" | "discovered" | "qualified" | "emails" | "offers" | "outreach";

export type DailyMetric = {
  day: string; // YYYY-MM-DD
  scraped: number;
  discovered: number;
  qualified: number;
  emails: number;
  offers: number;
  outreach: number;
};

// Display metadata for each tracked metric, in the order we show them. Labels
// are deliberately plain-language (no "scrape"/"enrich" jargon).
export const METRICS: { key: MetricKey; label: string; help: string; color: string }[] = [
  { key: "scraped", label: "Accounts scanned", help: "Instagram accounts we loaded and looked at.", color: "bg-sky-500" },
  { key: "discovered", label: "Leads found", help: "New potential leads added.", color: "bg-violet-500" },
  { key: "qualified", label: "Qualified leads", help: "Leads that passed your filters and scored well.", color: "bg-green-500" },
  { key: "emails", label: "Emails found", help: "Leads we found an email address for.", color: "bg-amber-500" },
  { key: "offers", label: "Offers found", help: "Leads where we identified the product or program they sell.", color: "bg-pink-500" },
  { key: "outreach", label: "Emails sent", help: "Outreach emails you sent to leads.", color: "bg-blue-500" },
];

// Pull daily metrics via the Postgres aggregation function. Returns [] (rather
// than throwing) if the function hasn't been migrated yet, so the dashboard
// degrades gracefully instead of crashing.
export async function fetchDailyMetrics(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  daysBack: number,
): Promise<{ rows: DailyMetric[]; error: string | null }> {
  const { data, error } = await client.rpc("metrics_daily", { days_back: daysBack });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as DailyMetric[], error: null };
}

export function sumMetric(rows: DailyMetric[], key: MetricKey): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}
