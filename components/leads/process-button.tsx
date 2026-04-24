"use client";
import { useState, useTransition } from "react";
import { Play, Loader2, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processLead } from "@/app/actions/process-lead";

type Props = {
  leadId: string;
  status: string;
  size?: "sm" | "default";
};

// Renders only for `pending` leads. Triggers the full profile+score pipeline
// for one lead via Inngest. After clicking, the row's status updates within
// ~30-60s when process-profile finishes.
export function ProcessButton({ leadId, status, size = "sm" }: Props) {
  const [pending, start] = useTransition();
  const [fired, setFired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "pending" && !fired) return null;

  const onClick = () => {
    setError(null);
    start(async () => {
      const r = await processLead(leadId);
      if (r.ok) setFired(true);
      else setError(r.error ?? "failed");
    });
  };

  if (fired) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Queued for processing">
        <Check className="h-3 w-3 text-green-600" /> Queued
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size={size} onClick={onClick} disabled={pending} title="Analyze this account and give it a score">
        {pending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : error ? <AlertCircle className="h-3 w-3 mr-1 text-red-600" /> : <Play className="h-3 w-3 mr-1" />}
        {pending ? "Starting…" : error ? "Try again" : "Analyze"}
      </Button>
      {error && (
        <span className="text-[10px] text-red-600 max-w-[180px] truncate" title={error}>{error}</span>
      )}
    </div>
  );
}
