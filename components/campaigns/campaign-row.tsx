"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";
import { CampaignDeleteAction } from "@/components/campaigns/campaign-delete-action";
import { LEAD_TRACK_LABELS } from "@/lib/leads/category";
import type { CampaignWithStats } from "@/app/actions/campaigns";

// Cold/warm chains are the only campaigns that can ever auto-send — the
// badge (and its color) is meant to make that impossible to miss in the list.
const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  cold_followup: { label: "Cold follow-up (auto)", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  warm_followup: { label: "Warm follow-up (auto)", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
};

export function CampaignRow({ campaign }: { campaign: CampaignWithStats }) {
  const router = useRouter();
  const totalSteps = campaign.variants.reduce((sum, v) => sum + v.steps.length, 0);
  const roleBadge = ROLE_BADGE[campaign.campaign_role];

  return (
    <TableRow
      className="cursor-pointer"
      onDoubleClick={(e) => {
        // Don't hijack a double-click on the delete action or the name link itself.
        const target = e.target as HTMLElement;
        if (target.closest("a,button,input,textarea,select,[role=button]")) return;
        router.push(`/campaigns/${campaign.id}`);
      }}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:underline">
            {campaign.name}
          </Link>
          {roleBadge && <Badge variant="outline" className={`text-xs ${roleBadge.className}`}>{roleBadge.label}</Badge>}
        </div>
      </TableCell>
      <TableCell><Badge variant="outline" className="text-xs">{LEAD_TRACK_LABELS[campaign.campaign_type]}</Badge></TableCell>
      <TableCell className="text-xs text-muted-foreground">{campaign.angle ?? "—"}</TableCell>
      <TableCell>
        <Badge variant={campaign.status === "active" ? "default" : "outline"}>{campaign.status}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {campaign.variants.length} variant{campaign.variants.length === 1 ? "" : "s"} · {totalSteps} step{totalSteps === 1 ? "" : "s"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{campaign.assigned_count}</TableCell>
      <TableCell className="text-right tabular-nums">{campaign.sent_count}</TableCell>
      <TableCell className="text-right tabular-nums">{campaign.replied_count}</TableCell>
      <TableCell className="text-right">
        <CampaignDeleteAction campaignId={campaign.id} />
      </TableCell>
    </TableRow>
  );
}
