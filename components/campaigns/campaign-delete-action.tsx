"use client";

import { useState, useTransition } from "react";
import { Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteCampaign } from "@/app/actions/campaigns";

export function CampaignDeleteAction({ campaignId }: { campaignId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function cancel() {
    setConfirming(false);
    setPassword("");
    setError(null);
  }

  function confirm() {
    start(async () => {
      setError(null);
      const res = await deleteCampaign(campaignId, password);
      if (!res.ok) setError(res.error ?? "Failed to delete campaign.");
    });
  }

  if (!confirming) {
    return (
      <Button
        size="icon"
        variant="ghost"
        title="Delete campaign"
        aria-label="Delete campaign"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Override password"
          className="w-36 h-8 text-xs"
          autoFocus
          disabled={pending}
          aria-label="Delete campaign override password"
          onKeyDown={(e) => {
            if (e.key === "Enter") confirm();
            if (e.key === "Escape") cancel();
          }}
        />
        <Button
          size="icon"
          variant="destructive"
          disabled={pending}
          title="Confirm delete"
          aria-label="Confirm delete"
          onClick={confirm}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" disabled={pending} title="Cancel" aria-label="Cancel" onClick={cancel}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
