export type KpiStatus = "ok" | "below" | "unknown";
export type KpiUnit = "count" | "percent" | "minutes";
export type KpiFrequency = "daily" | "monthly" | "per_lead";
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

export function averageDurationMinutes(
  intervals: Array<{ start: string | null; end: string | null }>,
): number | null {
  const durations = intervals.flatMap(({ start, end }) => {
    if (!start || !end) return [];
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
    return [(endMs - startMs) / 60000];
  });
  if (durations.length === 0) return null;
  return durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length;
}

type TimingRow = {
  lead_id: string;
  received_at: string;
  replied_at?: string | null;
  outreach_messages?: { sent_at?: string | null } | { sent_at?: string | null }[] | null;
};

function firstRowPerLead(rows: TimingRow[]): TimingRow[] {
  const earliest = new Map<string, TimingRow>();
  for (const row of rows) {
    const current = earliest.get(row.lead_id);
    if (!current || new Date(row.received_at).getTime() < new Date(current.received_at).getTime()) {
      earliest.set(row.lead_id, row);
    }
  }
  return [...earliest.values()];
}

function outreachSentAt(row: TimingRow): string | null {
  const outreach = Array.isArray(row.outreach_messages) ? row.outreach_messages[0] : row.outreach_messages;
  return outreach?.sent_at ?? null;
}

export async function fetchDailyKpis(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any>,
  range: { start: Date; end: Date },
): Promise<KpiRow[]> {
  const start = range.start.toISOString();
  const end = range.end.toISOString();

  const [
    { count: scraped, error: scrapedErr },
    { count: enriched, error: enrichedErr },
    { count: emailsSent, error: emailsSentErr },
    { data: speedRows, error: speedErr },
    { data: responseRows, error: responseErr },
    { count: positiveReplies, error: positiveErr },
  ] = await Promise.all([
    client.from("crawl_logs").select("*", { count: "exact", head: true })
      .eq("action", "scraped").gte("created_at", start).lte("created_at", end),
    client.from("leads").select("*", { count: "exact", head: true })
      .not("email", "is", null).gte("enriched_at", start).lte("enriched_at", end),
    client.from("outreach_messages").select("*", { count: "exact", head: true })
      .eq("status", "sent").gte("sent_at", start).lte("sent_at", end),
    client.from("inbox_messages").select("lead_id, received_at, replied_at")
      .eq("sentiment", "positive").not("replied_at", "is", null)
      .gte("replied_at", start).lte("replied_at", end),
    client.from("inbox_messages").select("lead_id, received_at, outreach_messages(sent_at)")
      .gte("received_at", start).lte("received_at", end),
    client.from("inbox_messages").select("*", { count: "exact", head: true })
      .eq("sentiment", "positive").gte("received_at", start).lte("received_at", end),
  ]);

  const speedIntervals = firstRowPerLead((speedRows ?? []) as TimingRow[]).map((row) => ({
    start: row.received_at,
    end: row.replied_at ?? null,
  }));
  const responseIntervals = firstRowPerLead((responseRows ?? []) as TimingRow[]).map((row) => ({
    start: outreachSentAt(row),
    end: row.received_at,
  }));

  const sentActual = emailsSentErr ? null : emailsSent ?? 0;
  const positiveActual = positiveErr ? null : positiveReplies ?? 0;

  return [
    buildKpiRow({ key: "leads_scraped", label: "Leads scraped", frequency: "daily", unit: "count", target: 500, targetLabel: "500", comparator: "at_least", actual: scrapedErr ? null : scraped ?? 0 }),
    buildKpiRow({ key: "leads_enriched", label: "Leads enriched", frequency: "daily", unit: "count", target: 100, targetLabel: "100", comparator: "at_least", actual: enrichedErr ? null : enriched ?? 0 }),
    buildKpiRow({ key: "emails_sent", label: "Emails sent", frequency: "daily", unit: "count", target: 100, targetLabel: "100", comparator: "at_least", actual: sentActual }),
    buildKpiRow({ key: "speed_to_lead", label: "Speed-to-lead", frequency: "per_lead", unit: "minutes", target: 60, targetLabel: "30-60 min", comparator: "at_most", actual: speedErr ? null : averageDurationMinutes(speedIntervals) }),
    buildKpiRow({ key: "first_response_time", label: "First response time", frequency: "daily", unit: "minutes", target: 120, targetLabel: "< 2 hours", comparator: "at_most", actual: responseErr ? null : averageDurationMinutes(responseIntervals) }),
    buildKpiRow({ key: "positive_reply_rate", label: "Positive reply rate", frequency: "daily", unit: "percent", target: 15, targetLabel: "15%", comparator: "at_least", actual: sentActual === null || positiveActual === null ? null : computePositiveReplyRate(positiveActual, sentActual) }),
  ];
}

export function assembleKpiRows(daily: KpiRow[], meetingsBookedActual: number | null, days = 1): KpiRow[] {
  const scaledDaily = daily.map((row) => {
    if (row.unit !== "count" || row.frequency !== "daily") return row;
    const target = row.target * days;
    return {
      ...row,
      target,
      targetLabel: target.toLocaleString("en-US"),
      status: computeStatus(row.actual, target, "at_least"),
    };
  });
  const meetingsRow = buildKpiRow({
    key: "meetings_booked",
    label: "Meetings booked",
    frequency: "monthly",
    unit: "count",
    target: days,
    targetLabel: days.toLocaleString("en-US"),
    comparator: "at_least",
    actual: meetingsBookedActual,
  });
  return [...scaledDaily, meetingsRow, computeTaskCompletion(scaledDaily.filter((row) => row.frequency === "daily"))];
}
