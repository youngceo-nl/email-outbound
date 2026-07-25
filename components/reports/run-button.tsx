"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Runs (or re-runs) an existing report row.
 *
 * Generation no longer goes through a queue, so nothing retries on its own — this
 * is the retry. It also recovers rows stranded by something outside the pipeline,
 * such as the reports queued while the Inngest sync was broken and whose events
 * were never delivered.
 *
 * Safe to press on a row that already has content: the offer-page scrape is
 * skipped if it ran recently, and the document is rebuilt from current lead data.
 */
export function RunButton({ reportId, label = "Run" }: { reportId: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      // Awaited so the serverless function stays alive for the whole run.
      const response = await fetch(`/api/reports/${reportId}/generate`, { method: "POST" });
      if (!response.ok && response.status !== 409) {
        const body = await response.json().catch(() => null);
        window.alert(body?.note ?? "Generation failed — the row shows the reason.");
      }
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={pending} className="shrink-0">
      {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCw className="mr-1 h-3 w-3" />}
      {pending ? "Running…" : label}
    </Button>
  );
}
