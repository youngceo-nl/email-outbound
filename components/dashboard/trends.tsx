"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  METRICS,
  sumMetric,
  fetchDailyMetrics,
  type DailyMetric,
  type MetricKey,
} from "@/lib/metrics";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export function Trends({
  initial,
  initialError,
}: {
  initial: DailyMetric[];
  initialError: string | null;
}) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<DailyMetric[]>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MetricKey>("qualified");

  // Re-fetch when the range changes (the server pre-loaded the 30-day window).
  useEffect(() => {
    if (days === 30 && rows === initial) return;
    let cancelled = false;
    setLoading(true);
    fetchDailyMetrics(createClient(), days).then((res) => {
      if (cancelled) return;
      setRows(res.rows);
      setError(res.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const active = METRICS.find((m) => m.key === selected)!;

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Trends over time</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Trends aren&rsquo;t available yet. Apply the latest database migration
            (<code className="text-xs">npm run db:push</code>) to enable them.
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">Details: {error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Trends over time</CardTitle>
          <CardDescription>How your results are adding up day by day.</CardDescription>
        </div>
        <div className="flex rounded-md border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-[5px] transition-colors",
                days === r.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Metric totals — click one to chart it below. */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {METRICS.map((m) => {
            const total = sumMetric(rows, m.key);
            const isSel = m.key === selected;
            return (
              <button
                key={m.key}
                onClick={() => setSelected(m.key)}
                className={cn(
                  "text-left rounded-lg border p-3 transition-colors",
                  isSel ? "border-foreground/30 bg-muted/50" : "hover:bg-muted/30",
                )}
              >
                <div className="flex items-center gap-1">
                  <span className={cn("h-2 w-2 rounded-full", m.color)} />
                  <span className="text-[11px] font-medium text-muted-foreground leading-tight">{m.label}</span>
                  <InfoTip text={m.help} />
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{total.toLocaleString()}</div>
              </button>
            );
          })}
        </div>

        <BarChart rows={rows} metric={selected} color={active.color} label={active.label} loading={loading} />
      </CardContent>
    </Card>
  );
}

function BarChart({
  rows,
  metric,
  color,
  label,
  loading,
}: {
  rows: DailyMetric[];
  metric: MetricKey;
  color: string;
  label: string;
  loading: boolean;
}) {
  const values = useMemo(() => rows.map((r) => Number(r[metric]) || 0), [rows, metric]);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No data for this range yet.</p>;
  }

  return (
    <div className={cn(loading && "opacity-50 transition-opacity")}>
      <div className="mb-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span> per day
      </div>
      <div className="flex items-end gap-[3px] h-32">
        {rows.map((r) => {
          const v = Number(r[metric]) || 0;
          const h = v === 0 ? 2 : Math.max(4, Math.round((v / max) * 100));
          return (
            <div
              key={r.day}
              className={cn(
                "flex-1 min-w-[2px] rounded-sm transition-all",
                v === 0 ? "bg-muted" : `${color} opacity-80 hover:opacity-100`,
              )}
              style={{ height: `${h}%` }}
              title={`${r.day}: ${v} ${label.toLowerCase()}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>{rows[0]?.day}</span>
        <span>{total.toLocaleString()} total</span>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  );
}
