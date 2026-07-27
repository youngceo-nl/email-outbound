"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteReportAction } from "@/app/actions/reports";

/**
 * Deletes a report and its stored PDF. Works on any status — it is also the
 * only way out for a row stuck in "generating" after a killed run.
 *
 * One native confirm instead of a dialog: the action is small, the list shows
 * exactly what is being removed, and a deleted report is one click to
 * regenerate — cheap enough that ceremony would cost more than a mistake.
 */
export function DeleteReportButton({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    if (!window.confirm("Delete this report and its PDF?")) return;
    startTransition(async () => {
      const result = await deleteReportAction(reportId);
      if (!result.ok) window.alert(result.error);
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={remove}
      disabled={pending}
      className="text-muted-foreground hover:text-red-600"
      title="Delete report"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </Button>
  );
}
