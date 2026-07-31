export type KpiStatus = "ok" | "below" | "unknown";
export type KpiUnit = "count" | "percent" | "minutes";
export type KpiFrequency = "daily" | "monthly";
export type Comparator = "at_least" | "at_most";

export type KpiRow = {
  key: string;
  label: string;
  frequency: KpiFrequency;
  unit: KpiUnit;
  target: number;
  targetLabel: string;
  actual: number | null;
  status: KpiStatus;
};

export function computeStatus(actual: number | null, target: number, comparator: Comparator): KpiStatus {
  if (actual === null) return "unknown";
  return comparator === "at_least"
    ? (actual >= target ? "ok" : "below")
    : (actual <= target ? "ok" : "below");
}

export function buildKpiRow(params: {
  key: string;
  label: string;
  frequency: KpiFrequency;
  unit: KpiUnit;
  target: number;
  targetLabel: string;
  comparator: Comparator;
  actual: number | null;
}): KpiRow {
  const { comparator, ...row } = params;
  return { ...row, status: computeStatus(params.actual, params.target, comparator) };
}

// Row 7: the fraction of the 5 daily KPIs (rows 1-5) that are on track today.
// Monthly-cadence rows (meetings booked) are never passed in here. A row
// whose own source is unreachable ("unknown") is excluded from both the
// numerator and denominator, so one outage doesn't drag completion down for
// metrics that had nothing to do with it.
export function computeTaskCompletion(dailyRows: KpiRow[]): KpiRow {
  const resolved = dailyRows.filter((r) => r.status !== "unknown");
  const actual = resolved.length === 0
    ? null
    : Math.round((resolved.filter((r) => r.status === "ok").length / resolved.length) * 100);
  return buildKpiRow({
    key: "task_completion",
    label: "Task completion",
    frequency: "daily",
    unit: "percent",
    target: 100,
    targetLabel: "100%",
    comparator: "at_least",
    actual,
  });
}

import type { SupabaseClient } from "@supabase/supabase-js";

export function computePositiveReplyRate(positiveReplies: number, emailsSent: number): number | null {
  if (emailsSent === 0) return null;
  return (positiveReplies / emailsSent) * 100;
}

// UTC midnight-to-midnight for "today" - same boundary convention as the
// existing `sentToday` counter in app/(dashboard)/outreach-ready/page.tsx.
function utcDayRange(): { start: string; end: string } {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchDailyKpis(client: SupabaseClient<any, any, any>): Promise<KpiRow[]> {
  const { start, end } = utcDayRange();

  const [
    { count: scraped, error: scrapedErr },
    { count: enriched, error: enrichedErr },
    { count: emailsSent, error: emailsSentErr },
    { data: repliedRows, error: repliedErr },
    { count: positiveReplies, error: positiveErr },
  ] = await Promise.all([
    client.from("crawl_logs").select("*", { count: "exact", head: true })
      .eq("action", "scraped").gte("created_at", start).lt("created_at", end),
    client.from("leads").select("*", { count: "exact", head: true })
      .not("email", "is", null).gte("enriched_at", start).lt("enriched_at", end),
    client.from("outreach_messages").select("*", { count: "exact", head: true })
      .eq("status", "sent").gte("sent_at", start).lt("sent_at", end),
    client.from("inbox_messages").select("received_at, replied_at")
      .not("replied_at", "is", null).gte("replied_at", start).lt("replied_at", end),
    client.from("inbox_messages").select("*", { count: "exact", head: true })
      .eq("sentiment", "positive").gte("received_at", start).lt("received_at", end),
  ]);

  if (scrapedErr) throw scrapedErr;
  if (enrichedErr) throw enrichedErr;
  if (emailsSentErr) throw emailsSentErr;
  if (repliedErr) throw repliedErr;
  if (positiveErr) throw positiveErr;

  const replied = (repliedRows ?? []) as { received_at: string; replied_at: string }[];
  const firstResponseMinutes = replied.length === 0 ? null : replied.reduce((sum, r) => {
    return sum + (new Date(r.replied_at).getTime() - new Date(r.received_at).getTime()) / 60000;
  }, 0) / replied.length;

  return [
    buildKpiRow({ key: "leads_scraped", label: "Leads scraped", frequency: "daily", unit: "count", target: 500, targetLabel: "500", comparator: "at_least", actual: scraped ?? 0 }),
    buildKpiRow({ key: "leads_enriched", label: "Leads enriched", frequency: "daily", unit: "count", target: 100, targetLabel: "100", comparator: "at_least", actual: enriched ?? 0 }),
    buildKpiRow({ key: "emails_sent", label: "Emails sent", frequency: "daily", unit: "count", target: 100, targetLabel: "100", comparator: "at_least", actual: emailsSent ?? 0 }),
    buildKpiRow({ key: "first_response_time", label: "First response time", frequency: "daily", unit: "minutes", target: 120, targetLabel: "< 2 hours", comparator: "at_most", actual: firstResponseMinutes }),
    buildKpiRow({ key: "positive_reply_rate", label: "Positive reply rate", frequency: "daily", unit: "percent", target: 15, targetLabel: "15%", comparator: "at_least", actual: computePositiveReplyRate(positiveReplies ?? 0, emailsSent ?? 0) }),
  ];
}

export function assembleKpiRows(daily: KpiRow[], meetingsBookedActual: number | null): KpiRow[] {
  const meetingsRow = buildKpiRow({
    key: "meetings_booked",
    label: "Meetings booked",
    frequency: "monthly",
    unit: "count",
    target: 30,
    targetLabel: "30",
    comparator: "at_least",
    actual: meetingsBookedActual,
  });
  return [...daily, meetingsRow, computeTaskCompletion(daily)];
}
