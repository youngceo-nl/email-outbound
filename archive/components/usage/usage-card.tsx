"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, AlertCircle } from "lucide-react";
import type { ProviderStatus } from "@/lib/usage/types";
import type { ProviderMeta } from "@/lib/usage/pricing";

export function UsageCard({ status, meta }: { status: ProviderStatus; meta: ProviderMeta }) {
  const pct = status.used != null && status.total != null && status.total > 0
    ? Math.min(100, (status.used / status.total) * 100)
    : null;
  const tone = toneOf(pct);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Dot tone={statusDot(status)} />
          <CardTitle className="text-base">{status.name}</CardTitle>
          {status.plan && <Badge variant="outline" className="text-xs">{status.plan}</Badge>}
        </div>
        <a
          href={meta.dashboardUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          title="Open billing dashboard"
        >
          dashboard <ExternalLink className="h-3 w-3" />
        </a>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.used != null && status.total != null ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{formatNum(status.used)}</span>
              <span className="text-sm text-muted-foreground">/ {formatNum(status.total)} {status.unit}</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full transition-all ${barClass(tone)}`}
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {pct != null ? `${pct.toFixed(1)}% used` : "—"}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{status.note ?? "—"}</p>
        )}

        {status.error && (
          <p className="text-xs text-red-600 inline-flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {status.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function statusDot(s: ProviderStatus): "green" | "yellow" | "red" {
  if (!s.configured) return "red";
  if (s.error) return "red";
  if (s.live) {
    if (s.used != null && s.total != null && s.total > 0) {
      const pct = (s.used / s.total) * 100;
      if (pct >= 95) return "red";
      if (pct >= 80) return "yellow";
    }
    return "green";
  }
  return "yellow";
}

function toneOf(pct: number | null): "green" | "yellow" | "red" {
  if (pct == null) return "green";
  if (pct >= 95) return "red";
  if (pct >= 80) return "yellow";
  return "green";
}

function barClass(tone: "green" | "yellow" | "red"): string {
  if (tone === "red") return "bg-red-500";
  if (tone === "yellow") return "bg-yellow-500";
  return "bg-primary";
}

function Dot({ tone }: { tone: "green" | "yellow" | "red" }) {
  const cls = tone === "red" ? "bg-red-500" : tone === "yellow" ? "bg-yellow-500" : "bg-green-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

function formatNum(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
