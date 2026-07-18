"use client";
import { useTransition, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, CheckCircle2 } from "lucide-react";
import { retryChurnEnrichment, getChurnRetryProgress } from "@/app/actions/leads";

type RunState =
  | { phase: "idle" }
  | { phase: "queueing" }
  | { phase: "running"; ids: string[]; startedAt: string; total: number; done: number; foundEmail: number }
  | { phase: "done"; total: number; foundEmail: number };

export function RetryChurnButton({ total }: { total: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll while running
  useEffect(() => {
    if (state.phase !== "running") return;
    const { ids, startedAt, total: t } = state;

    intervalRef.current = setInterval(async () => {
      const progress = await getChurnRetryProgress(ids, startedAt);
      setState((prev) =>
        prev.phase === "running"
          ? { ...prev, done: progress.done, foundEmail: progress.foundEmail }
          : prev,
      );
      if (progress.done >= t) {
        clearInterval(intervalRef.current!);
        setState({ phase: "done", total: t, foundEmail: progress.foundEmail });
        router.refresh();
      }
    }, 3000);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state.phase === "running" ? state.startedAt : null]); // eslint-disable-line

  const handleRun = () => {
    setState({ phase: "queueing" });
    startTransition(async () => {
      const r = await retryChurnEnrichment(50);
      if (!r.ok || r.queued === 0) {
        setState({ phase: "idle" });
        return;
      }
      setState({ phase: "running", ids: r.ids, startedAt: r.startedAt, total: r.queued, done: 0, foundEmail: 0 });
    });
  };

  if (state.phase === "idle") {
    return (
      <Button variant="outline" size="sm" disabled={total === 0} onClick={handleRun}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        Retry all {total}
      </Button>
    );
  }

  if (state.phase === "queueing") {
    return (
      <Button variant="outline" size="sm" disabled>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        Queueing…
      </Button>
    );
  }

  if (state.phase === "running") {
    const pct = state.total > 0 ? Math.round((state.done / state.total) * 100) : 0;
    return (
      <div className="flex flex-col items-end gap-1.5 min-w-[180px]">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
          <span>{state.done} / {state.total} enriched</span>
        </div>
        <Progress value={pct} className="h-1.5 w-full" />
      </div>
    );
  }

  // done
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
      <span>
        Done — {state.foundEmail > 0
          ? `${state.foundEmail} of ${state.total} got an email`
          : `${state.total} checked, no new emails found`}
      </span>
    </div>
  );
}
