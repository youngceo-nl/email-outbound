"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateReportForLead } from "@/app/actions/reports";

/**
 * One-click generation from the Reports list.
 *
 * Sends no overrides, so every input resolves through the cascade — a scraped
 * price is used where one exists and everything else is labelled an assumption in
 * the document itself. Adjusting inputs first is the lead-page panel's job; this
 * is the "just make it" path.
 */

/**
 * Creates the report row, then drives the run from the browser.
 *
 * The fetch is awaited so the serverless function stays alive for the whole
 * generation; a caller that fired and forgot would frequently see the work killed
 * mid-flight.
 */
async function createThenRun(leadId: string, formData: FormData): Promise<string | null> {
  const created = await generateReportForLead(leadId, formData);
  if (!created.ok) {
    window.alert(created.error);
    return null;
  }
  const response = await fetch(`/api/reports/${created.reportId}/generate`, { method: "POST" });
  if (!response.ok && response.status !== 409) {
    const body = await response.json().catch(() => null);
    // The row still exists and shows its own failure state, so this is a nudge
    // rather than the only record of what went wrong.
    window.alert(body?.note ?? "Generation failed — see the report row for details.");
  }
  return created.reportId;
}

export function GenerateButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      // An empty FormData means no overrides — the action treats absent fields as
      // "resolve it yourself" rather than as zero.
      await createThenRun(leadId, new FormData());
      router.refresh();
    });
  }

  return (
    <Button size="sm" onClick={generate} disabled={pending} className="shrink-0">
      {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {pending ? "Generating…" : "Generate"}
    </Button>
  );
}
