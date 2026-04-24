import type { DailyPoint } from "@/lib/billing/summary";

function fmt(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Lightweight bar chart of metered spend per day this month. Presentational only
// (no client JS) — each bar carries a native title tooltip.
export function SpendChart({ daily }: { daily: DailyPoint[] }) {
  const max = Math.max(0.0001, ...daily.map((d) => d.usd));
  const total = daily.reduce((s, d) => s + d.usd, 0);

  if (total <= 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No metered API spend recorded yet this month. Run an enrichment to start tracking.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-[3px] h-28">
        {daily.map((d) => {
          const h = Math.max(2, Math.round((d.usd / max) * 100));
          return (
            <div
              key={d.date}
              className="flex-1 min-w-[3px] bg-primary/80 hover:bg-primary rounded-sm transition-colors"
              style={{ height: `${h}%` }}
              title={`${d.date}: ${fmt(d.usd)}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>Day 1</span>
        <span>Day {daily.length}</span>
      </div>
    </div>
  );
}
