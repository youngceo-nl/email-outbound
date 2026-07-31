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
  if (row.actual === null) return "—";
  if (row.unit === "percent") return `${row.actual.toFixed(0)}%`;
  if (row.unit === "minutes") {
    const hours = row.actual / 60;
    return hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(row.actual)}m`;
  }
  return Math.round(row.actual).toLocaleString();
}

export function KpiTable({ rows }: { rows: KpiRow[] }) {
  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Metric</th>
            <th className="text-left px-4 py-2 font-medium">Target</th>
            <th className="text-left px-4 py-2 font-medium">Frequency</th>
            <th className="text-left px-4 py-2 font-medium">Actual</th>
            <th className="text-left px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-4 py-2 font-medium">{row.label}</td>
              <td className="px-4 py-2 text-muted-foreground">{row.targetLabel}</td>
              <td className="px-4 py-2 text-muted-foreground capitalize">{row.frequency}</td>
              <td className="px-4 py-2 tabular-nums">{formatActual(row)}</td>
              <td className="px-4 py-2">
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
