"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateCampaign, setCampaignStatus } from "@/app/actions/campaigns";
import type { Campaign, CampaignStatus } from "@/lib/types";

const STATUSES: CampaignStatus[] = ["active", "paused", "archived"];

export function CampaignHeaderForm({ campaign }: { campaign: Campaign }) {
  const [name, setName] = useState(campaign.name);
  const [angle, setAngle] = useState(campaign.angle ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const save = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await updateCampaign(campaign.id, { name, angle: angle || null });
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(r.error ?? "Save failed");
      }
    });
  };

  const changeStatus = (status: CampaignStatus) => {
    start(async () => {
      const r = await setCampaignStatus(campaign.id, status);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm font-medium" />
        <select
          value={campaign.status}
          onChange={(e) => changeStatus(e.target.value as CampaignStatus)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          disabled={pending}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <Input
        value={angle}
        onChange={(e) => setAngle(e.target.value)}
        placeholder="Angle / positioning notes (optional)"
        className="max-w-lg text-sm"
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={save} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Save
        </Button>
        {saved && !pending && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </span>
        )}
      </div>
    </div>
  );
}
