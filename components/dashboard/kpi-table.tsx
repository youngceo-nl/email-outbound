import type { KpiRow } from "@/lib/kpi";

const STATUS_LABEL: Record<KpiRow["status"], string> = {
  ok: "On track",
  below: "Below target",
  unknown: "Not connected",
};

const STATUS_CLASS: Record<KpiRow["status"], string> = {
  ok: "bg-green-100 text-green-800",
  below: "bg-red-100 text-red-800",
  unknown: "bg-muted text-muted-foreground",
};

function formatActual(row: KpiRow): string {
  if (row.actual === null) return "Unavailable";
  if (row.unit === "percent") return `${row.actual.toFixed(0)}%`;
  if (row.unit === "minutes") {
    const hours = row.actual / 60;
    return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(row.actual)}m`;
  }
  return Math.round(row.actual).toLocaleString();
}

export function KpiTable({ rows, periodLabel }: { rows: KpiRow[]; periodLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-y bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-6 py-3 font-medium">KPI</th>
            <th className="text-left px-4 py-3 font-medium">Target</th>
            <th className="text-left px-4 py-3 font-medium">Frequency</th>
            <th className="text-right px-4 py-3 font-medium">{periodLabel}</th>
            <th className="text-right px-6 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.key} className="transition-colors hover:bg-muted/25">
              <td className="px-6 py-3.5 font-medium">{row.label}</td>
              <td className="px-4 py-3.5 text-muted-foreground tabular-nums">{row.targetLabel}</td>
              <td className="px-4 py-3.5 text-muted-foreground">
                {row.frequency === "per_lead" ? "Per lead" : row.frequency === "monthly" ? "Monthly" : "Daily"}
              </td>
              <td className="px-4 py-3.5 text-right font-medium tabular-nums">
                {formatActual(row)}
                {row.frequency === "monthly" && row.actual !== null && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">this month</span>
                )}
              </td>
              <td className="px-6 py-3.5 text-right">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[row.status]}`}>
                  {STATUS_LABEL[row.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
