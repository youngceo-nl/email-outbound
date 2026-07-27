"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { restoreCampaign } from "@/app/actions/campaigns";
import { daysUntilPurge } from "@/lib/campaigns/retention";

export function CampaignRestoreBanner({ campaignId, deletedAt }: { campaignId: string; deletedAt: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const days = daysUntilPurge(deletedAt);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          This campaign was deleted on {new Date(deletedAt).toLocaleDateString()} — restore it or it will be
          permanently removed in {days} day{days === 1 ? "" : "s"}.
          {error && <span className="block text-destructive">{error}</span>}
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await restoreCampaign(campaignId);
            if (!res.ok) setError(res.error ?? "Failed to restore campaign.");
          })
        }
      >
        <RotateCcw className="h-3.5 w-3.5 mr-1" />
        {pending ? "Restoring…" : "Restore"}
      </Button>
    </div>
  );
}
