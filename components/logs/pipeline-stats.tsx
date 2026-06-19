"use client";
import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resetApifyExhausted, resetBlocked } from "@/app/actions/leads";
import { useRouter } from "next/navigation";

type Stats = {
  byStatus: Record<string, number>;
  byBlockReason: Record<string, number>;
};

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-blue-100 text-blue-800",
  qualified: "bg-green-100 text-green-800",
  review:    "bg-yellow-100 text-yellow-800",
  rejected:  "bg-red-100 text-red-800",
};

const BLOCK_COLORS: Record<string, string> = {
  blocked:         "bg-orange-100 text-orange-800",
  apify_exhausted: "bg-red-100 text-red-800",
};

const BLOCK_LABELS: Record<string, string> = {
  blocked:         "Unreachable (private/deleted)",
  apify_exhausted: "Apify token exhausted — retryable",
};

export function PipelineStats({ stats }: { stats: Stats }) {
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const router = useRouter();

  const exhaustedCount = stats.byBlockReason["apify_exhausted"] ?? 0;
  const blockedCount = stats.byBlockReason["blocked"] ?? 0;
  const total = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);

  const handleReset = async (type: "apify_exhausted" | "blocked") => {
    setResetting(type);
    const r = type === "apify_exhausted" ? await resetApifyExhausted() : await resetBlocked();
    setResetting(null);
    if (r.ok) {
      setResetMsg(`Reset ${r.reset} accounts — run backfill to retry them.`);
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      {/* Lead status breakdown */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Lead pipeline ({total.toLocaleString()} total)</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
            <span key={s} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[s] ?? "bg-muted text-muted-foreground"}`}>
              {s} <span className="font-bold tabular-nums">{n.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Blocked accounts breakdown */}
      {Object.keys(stats.byBlockReason).length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Blocked accounts</p>
          <div className="flex flex-wrap gap-2 items-center">
            {Object.entries(stats.byBlockReason).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
              <span key={r} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${BLOCK_COLORS[r] ?? "bg-muted text-muted-foreground"}`}>
                {r === "apify_exhausted" && <AlertTriangle className="h-3 w-3" />}
                {BLOCK_LABELS[r] ?? r} <span className="font-bold tabular-nums">{n.toLocaleString()}</span>
              </span>
            ))}

            {exhaustedCount > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs"
                disabled={!!resetting} onClick={() => handleReset("apify_exhausted")}>
                <RefreshCw className={`h-3 w-3 mr-1 ${resetting === "apify_exhausted" ? "animate-spin" : ""}`} />
                Reset & retry {exhaustedCount} (Apify exhausted)
              </Button>
            )}
            {blockedCount > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs"
                disabled={!!resetting} onClick={() => handleReset("blocked")}>
                <RefreshCw className={`h-3 w-3 mr-1 ${resetting === "blocked" ? "animate-spin" : ""}`} />
                Retry {blockedCount} blocked with cookie
              </Button>
            )}
            {resetMsg && <span className="text-xs text-green-600">{resetMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
