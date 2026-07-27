"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { restoreCampaign, type DeletedCampaign } from "@/app/actions/campaigns";
import { daysUntilPurge } from "@/lib/campaigns/retention";
import { LEAD_TRACK_LABELS } from "@/lib/leads/category";

export function DeletedCampaignsSection({ campaigns }: { campaigns: DeletedCampaign[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Recently deleted ({campaigns.length})
      </button>
      {open && (
        <div className="divide-y border-t">
          {campaigns.map((c) => (
            <DeletedCampaignRow key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeletedCampaignRow({ campaign }: { campaign: DeletedCampaign }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{campaign.name}</span>
          <Badge variant="outline" className="text-xs">{LEAD_TRACK_LABELS[campaign.campaign_type]}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {daysUntilPurge(campaign.deleted_at)} day{daysUntilPurge(campaign.deleted_at) === 1 ? "" : "s"} left before permanent removal
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await restoreCampaign(campaign.id);
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
