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
export function GenerateButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      // An empty FormData means no overrides — the action treats absent fields as
      // "resolve it yourself" rather than as zero.
      const result = await generateReportForLead(leadId, new FormData());
      if (!result.ok) window.alert(result.error);
      router.refresh();
    });
  }

  return (
    <Button size="sm" onClick={generate} disabled={pending} className="shrink-0">
      {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      Generate
    </Button>
  );
}
