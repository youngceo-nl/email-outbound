export type RangePreset = "today" | "7d" | "30d" | "90d" | "all";

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

export type ResolvedRange = {
  start: Date | null;
  end: Date | null;
  /** null when a custom start/end pair is active instead of a preset. */
  preset: RangePreset | null;
};

function startOfDaysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

export function resolveDateRange(params: { range?: string; start?: string; end?: string }): ResolvedRange {
  if (params.start && params.end) {
    const start = new Date(`${params.start}T00:00:00`);
    const end = new Date(`${params.end}T23:59:59.999`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return { start, end, preset: null };
    }
  }

  const preset = RANGE_PRESETS.find((p) => p.key === params.range)?.key ?? "all";
  if (preset === "all") return { start: null, end: null, preset };
  if (preset === "today") return { start: startOfDaysAgo(0), end: new Date(), preset };

  const daysBack = preset === "7d" ? 6 : preset === "30d" ? 29 : 89;
  return { start: startOfDaysAgo(daysBack), end: new Date(), preset };
}

export function inclusiveRangeDays(range: ResolvedRange): number {
  if (!range.start || !range.end) return 1;
  const start = Date.UTC(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
  const end = Date.UTC(range.end.getFullYear(), range.end.getMonth(), range.end.getDate());
  return Math.max(1, Math.floor((end - start) / 86400000) + 1);
}

export function rangeLabel(range: ResolvedRange): string {
  if (range.preset) return RANGE_PRESETS.find((item) => item.key === range.preset)?.label ?? "All time";
  const isoDate = (date: Date | null) => date
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
    : "";
  return `${isoDate(range.start)} - ${isoDate(range.end)}`;
}
