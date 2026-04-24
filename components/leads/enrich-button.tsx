"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, AlertCircle, Check } from "lucide-react";
import { enrichLead } from "@/app/actions/enrich";

type Props = {
  leadId: string;
  initialEmail: string | null;
  initialStatus: string | null;
  size?: "sm" | "default";
};

export function EnrichButton({ leadId, initialEmail, initialStatus, size = "sm" }: Props) {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    start(async () => {
      const r = await enrichLead(leadId);
      if (r.ok) {
        setEmail(r.email ?? null);
        setStatus(r.email_status ?? null);
      } else {
        setError(r.error ?? "unknown error");
      }
    });
  };

  if (email) {
    return (
      <a
        href={`mailto:${email}`}
        className="inline-flex items-center gap-1 text-xs hover:underline"
        title={status ?? "found"}
      >
        <Check className="h-3 w-3 text-green-600" />
        <span className="truncate max-w-[180px]">{email}</span>
      </a>
    );
  }

  const skipped = status?.startsWith("skipped:");
  const errored = status === "error";

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size={size}
        onClick={onClick}
        disabled={pending}
        title={skipped ? `Last attempt: ${status}` : errored ? "Last attempt failed — try again" : "Look up this person's email address"}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : errored || error ? (
          <AlertCircle className="h-3 w-3 mr-1 text-red-600" />
        ) : (
          <Mail className="h-3 w-3 mr-1" />
        )}
        {pending ? "Looking…" : errored || error ? "Try again" : "Find email"}
      </Button>
      {(error || (status && status !== "not_found" && skipped)) && (
        <span className="text-[10px] text-muted-foreground max-w-[180px] truncate" title={error ?? status ?? ""}>
          {error ?? status}
        </span>
      )}
    </div>
  );
}
