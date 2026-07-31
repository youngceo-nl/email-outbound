"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { createCampaign } from "@/app/actions/campaigns";
import { LEAD_TRACK_LABELS } from "@/lib/leads/category";
import type { CampaignRole, CampaignType } from "@/lib/types";

const TYPES: CampaignType[] = ["infopreneur", "partnership"];

const ROLE_LABELS: Record<CampaignRole, string> = {
  primary: "Primary (human-run)",
  cold_followup: "Cold follow-up (auto)",
  warm_followup: "Warm follow-up (auto)",
};
const ROLES: CampaignRole[] = ["primary", "cold_followup", "warm_followup"];

export function NewCampaignForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [angle, setAngle] = useState("");
  const [campaignType, setCampaignType] = useState<CampaignType>("infopreneur");
  const [campaignRole, setCampaignRole] = useState<CampaignRole>("primary");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = () => {
    setError(null);
    start(async () => {
      const r = await createCampaign(name, angle || null, campaignType, campaignRole);
      if (r.ok && r.id) {
        setOpen(false);
        setName("");
        setAngle("");
        router.push(`/campaigns/${r.id}`);
      } else {
        setError(r.error ?? "Something went wrong.");
      }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New campaign
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <p className="text-sm font-medium">New campaign</p>
        <Input
          placeholder="Name (e.g. Q3 coaches outreach)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          placeholder="Angle / notes (optional)"
          value={angle}
          onChange={(e) => setAngle(e.target.value)}
        />
        <select
          value={campaignType}
          onChange={(e) => setCampaignType(e.target.value as CampaignType)}
          className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>{LEAD_TRACK_LABELS[t]}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Only {LEAD_TRACK_LABELS[campaignType].toLowerCase()} leads can be added to this campaign.
        </p>
        <select
          value={campaignRole}
          onChange={(e) => setCampaignRole(e.target.value as CampaignRole)}
          className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
        {campaignRole !== "primary" && (
          <p className="text-xs text-muted-foreground">
            At most one {ROLE_LABELS[campaignRole].split(" ")[0].toLowerCase()} follow-up campaign per type. Starts
            paused — nothing auto-sends until you switch its status to active.
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-full" disabled={pending || !name.trim()} onClick={submit}>
          {pending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Create
        </Button>
      </PopoverContent>
    </Popover>
  );
}
