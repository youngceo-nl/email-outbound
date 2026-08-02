"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, HelpCircle, Loader2, XCircle } from "lucide-react";
import {
  approveLead,
  getEvidenceReviewQueue,
  rejectLead,
  type EvidenceReviewLead,
} from "@/app/actions/review";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn, scoreColor } from "@/lib/utils";

const CERTAINTY_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "outline",
};

/**
 * Same one-card-at-a-time flow as ReviewClient, for leads the evidence-first
 * pipeline (lib/qualification/*) marked decision='review' instead of a
 * follower/engagement/keyword-driven legacy score. No track tabs (one queue)
 * and no undo — undoing an approve here would need to know the lead's
 * pre-review status (usually 'rejected', not always), which nothing captures
 * yet, so skip rather than risk restoring the wrong state.
 */
export function EvidenceReviewClient({
  queue,
  totalPending,
}: {
  queue: EvidenceReviewLead[];
  /** Total leads still awaiting a verdict — queue itself is capped at one page (100). */
  totalPending: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<EvidenceReviewLead[]>(queue);
  const [idx, setIdx] = useState(0);
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const lead = items[idx];
  const remaining = items.length - idx;

  const advance = useCallback(() => {
    setRejecting(false);
    setReason("");
    setError(null);
    setIdx((i) => i + 1);
  }, []);

  const doApprove = useCallback(() => {
    if (!lead || pending) return;
    start(async () => {
      const res = await approveLead(lead.id);
      if (!res.ok) return setError(res.error ?? "Could not approve.");
      advance();
      router.refresh();
    });
  }, [lead, pending, advance, router]);

  const doReject = useCallback(() => {
    if (!lead || pending) return;
    start(async () => {
      const res = await rejectLead(lead.id, reason);
      if (!res.ok) return setError(res.error ?? "Could not reject.");
      advance();
      router.refresh();
    });
  }, [lead, pending, reason, advance, router]);

  const onRejectClick = useCallback(() => {
    if (rejecting) doReject();
    else {
      setRejecting(true);
      setTimeout(() => reasonRef.current?.focus(), 0);
    }
  }, [rejecting, doReject]);

  const changeOrder = useCallback(
    (next: "asc" | "desc") => {
      if (next === order || pending) return;
      setOrder(next);
      start(async () => {
        setItems(await getEvidenceReviewQueue(100, next));
        setIdx(0);
        setRejecting(false);
        setReason("");
        setError(null);
      });
    },
    [order, pending],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT") {
        if (e.key === "Enter" && rejecting && (e.metaKey || e.ctrlKey)) doReject();
        return;
      }
      switch (e.key.toLowerCase()) {
        case "a":
          e.preventDefault();
          doApprove();
          break;
        case "r":
          e.preventDefault();
          if (rejecting) doReject();
          else {
            setRejecting(true);
            setTimeout(() => reasonRef.current?.focus(), 0);
          }
          break;
        case "j":
        case "k":
        case "arrowdown":
        case "arrowright":
          e.preventDefault();
          advance();
          break;
        case "escape":
          if (rejecting) setRejecting(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doApprove, doReject, advance, rejecting]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            {remaining} of {totalPending} left · flagged by the evidence-first pipeline as uncertain, not auto-decided either way
            {totalPending > items.length && (
              <span className="block mt-0.5">
                Loaded {items.length} at a time — reload the page once this batch is done to pull the next {Math.min(100, totalPending - items.length)}.
              </span>
            )}
          </p>
          <div className="mt-2 inline-flex rounded-md border text-xs overflow-hidden">
            {(["asc", "desc"] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                disabled={pending}
                onClick={() => changeOrder(dir)}
                className={cn(
                  "px-2.5 py-1 transition-colors disabled:opacity-50",
                  order === dir ? "bg-accent font-medium" : "hover:bg-accent/50 text-muted-foreground",
                )}
              >
                {dir === "asc" ? "Low → High" : "High → Low"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!lead ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
          All caught up. Reload for more.
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums rounded-md px-2 py-1",
                  scoreColor(lead.commercial_fit),
                )}
              >
                {lead.commercial_fit ?? "–"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <a
                    href={lead.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline truncate"
                  >
                    @{lead.username}
                  </a>
                  <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
                {lead.full_name && <p className="text-sm text-muted-foreground truncate">{lead.full_name}</p>}
              </div>
              <div className="flex flex-wrap gap-1 justify-end">
                <Badge variant={CERTAINTY_VARIANT[lead.certainty] ?? "outline"} className="text-[10px]">
                  {lead.certainty} certainty
                </Badge>
                <Badge variant="outline" className="text-[10px]">{lead.track}</Badge>
              </div>
            </div>

            {lead.bio && <p className="text-sm whitespace-pre-wrap">{lead.bio}</p>}

            {lead.external_link && (
              <a
                href={lead.external_link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all inline-flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                {lead.external_link}
              </a>
            )}

            {lead.followers != null && (
              <div className="text-xs text-muted-foreground tabular-nums">{lead.followers.toLocaleString()} followers</div>
            )}

            {Object.keys(lead.score_components).length > 0 && (
              <div className="space-y-1.5 border-l-2 pl-3">
                {Object.entries(lead.score_components).map(([key, c]) => (
                  <div key={key} className="text-xs">
                    <span className="font-medium tabular-nums">{c.value}</span>{" "}
                    <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
                    {c.reason && <span className="text-muted-foreground"> — {c.reason}</span>}
                    {c.citations?.[0]?.phrase && (
                      <p className="text-muted-foreground/80 italic mt-0.5">"{c.citations[0].phrase}"</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {(lead.decision_reasons.length > 0 || lead.review_flags.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {lead.decision_reasons.map((r) => (
                  <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                ))}
                {lead.review_flags.map((f) => (
                  <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                ))}
              </div>
            )}
          </div>

          {rejecting && (
            <div className="px-5 pb-4 space-y-2 border-t pt-4 bg-muted/20">
              <p className="text-xs font-medium">Why is this a bad lead?</p>
              <Textarea
                ref={reasonRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Type the reason… (⌘/Ctrl+Enter to confirm)"
                className="min-h-[56px] text-xs"
              />
            </div>
          )}

          {error && <p className="px-5 pb-2 text-xs text-destructive">{error}</p>}

          <div className="flex items-center gap-2 px-5 py-3 border-t bg-muted/20">
            <Button variant="default" className="flex-1" disabled={pending} onClick={doApprove}>
              {pending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
              Approve <kbd className="ml-1.5 px-1 rounded bg-background/40 text-[10px]">a</kbd>
            </Button>
            <Button variant="destructive" className="flex-1" disabled={pending} onClick={onRejectClick}>
              <XCircle className="h-4 w-4 mr-1.5" />
              {rejecting ? "Confirm reject" : "Reject"} <kbd className="ml-1.5 px-1 rounded bg-background/40 text-[10px]">r</kbd>
            </Button>
            <Button variant="outline" className="flex-1" disabled={pending} onClick={advance} title="Skip for now">
              <HelpCircle className="h-4 w-4 mr-1.5" />
              Skip <kbd className="ml-1.5 px-1 rounded bg-muted text-[10px]">j</kbd>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
