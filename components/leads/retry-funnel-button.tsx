"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SearchCode, CheckCircle2, Loader2 } from "lucide-react";
import { retryFunnelEnrichment } from "@/app/actions/leads";

type State =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; found: number; total: number };

export function RetryFunnelButton({ missingCount }: { missingCount: number }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [state, setState] = useState<State>({ phase: "idle" });

  const handleRun = () => {
    setState({ phase: "running" });
    start(async () => {
      const r = await retryFunnelEnrichment(50);
      const found = r.results.filter((x) => x.program_name).length;
      setState({ phase: "done", found, total: r.queued });
      router.refresh();
    });
  };

  if (state.phase === "done") {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
        <span>
          {state.found > 0
            ? `Found program names for ${state.found} of ${state.total}`
            : `Checked ${state.total} — no new program names`}
        </span>
      </div>
    );
  }

  if (state.phase === "running") {
    return (
      <Button variant="outline" size="sm" disabled>
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        Enriching…
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={missingCount === 0}
      onClick={handleRun}
      title="Re-enrich program names using free methods (no ScrapingBee)"
    >
      <SearchCode className="h-3.5 w-3.5 mr-1.5" />
      Re-enrich {missingCount} program names
    </Button>
  );
}
