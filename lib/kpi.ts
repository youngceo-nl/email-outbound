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
