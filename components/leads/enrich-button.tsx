"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, AlertCircle, Check, RefreshCw } from "lucide-react";
import { enrichLead } from "@/app/actions/enrich";

type Props = {
  leadId: string;
  initialEmail: string | null;
  initialStatus: string | null;
  initialError?: string | null;
  size?: "sm" | "default";
};

export function EnrichButton({ leadId, initialEmail, initialStatus, initialError, size = "sm" }: Props) {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState(initialStatus);
  // `message` is the human-readable summary; `detail` is the raw step-by-step
  // trace, shown only when the user expands "Details".
  const [message, setMessage] = useState<string | null>(deriveInitialMessage(initialStatus));
  const [detail, setDetail] = useState<string | null>(initialError ?? null);
  const [showDetail, setShowDetail] = useState(false);

  const onClick = () => {
    setMessage(null);
    setShowDetail(false);
    start(async () => {
      const r = await enrichLead(leadId);
      setStatus(r.email_status ?? null);
      if (r.ok && r.email) {
        setEmail(r.email);
        setMessage(null);
        setDetail(null);
      } else {
        setMessage(r.error ?? "Something went wrong. Please try again.");
        setDetail(r.detail ?? null);
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

  const isError = status === "error";
  // "Tried" = we ran a lookup before (or are showing a prior result), so the
  // primary action becomes "Try again" rather than the first-time "Find email".
  const tried = !!message;

  return (
    <div className="flex flex-col gap-1 max-w-[230px]">
      <Button
        variant="outline"
        size={size}
        onClick={onClick}
        disabled={pending}
        title={tried ? "Search the public sources again" : "Look up this person's email"}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : isError ? (
          <AlertCircle className="h-3 w-3 mr-1 text-red-600" />
        ) : tried ? (
          <RefreshCw className="h-3 w-3 mr-1 text-amber-600" />
        ) : (
          <Mail className="h-3 w-3 mr-1" />
        )}
        {pending ? "Looking…" : tried ? "Try again" : "Find email"}
      </Button>

      {!pending && message && (
        <div className={`text-[11px] leading-snug ${isError ? "text-red-600" : "text-muted-foreground"}`}>
          <p>{message}</p>
          {detail && (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="mt-0.5 underline decoration-dotted hover:text-foreground"
            >
              {showDetail ? "Hide details" : "Details"}
            </button>
          )}
          {showDetail && detail && (
            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground/80">
              {detail}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// On first render we only know the stored status, not a fresh summary, so map
// it to a friendly prompt. A fresh lookup replaces this with the pipeline's
// own message.
function deriveInitialMessage(status: string | null | undefined): string | null {
  if (!status) return null;
  if (status === "not_found") return "No public email found. Click to search again.";
  if (status === "error") return "The last search hit a problem. Click to try again.";
  if (status.startsWith("skipped:")) return "Email lookup was skipped for this lead. Click to try now.";
  return null;
}
