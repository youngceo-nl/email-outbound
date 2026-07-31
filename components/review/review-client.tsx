"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, HelpCircle, Loader2, Undo2, XCircle } from "lucide-react";
import { approveLead, deferLead, getReviewQueue, rejectLead, undoReview, type ReviewLead, type ReviewStats, type ReviewTrack } from "@/app/actions/review";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn, scoreColor } from "@/lib/utils";

const TARGET = 0.05;

function rateColor(rate: number, reviewed: number): string {
  if (reviewed === 0) return "text-muted-foreground";
  if (rate <= TARGET) return "text-green-600 dark:text-green-400";
  if (rate <= TARGET * 2) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

function StatBlock({ label, stats }: { label: string; stats: ReviewStats }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums", rateColor(stats.badRate, stats.reviewed))}>
        {stats.reviewed === 0 ? "—" : `${(stats.badRate * 100).toFixed(1)}%`}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {stats.rejected}/{stats.reviewed} bad
      </span>
    </div>
  );
}

export function ReviewClient({
  queue,
  stats,
  trackCounts,
}: {
  queue: ReviewLead[];
  stats: { allTime: ReviewStats; last7: ReviewStats };
  trackCounts: Record<ReviewTrack, number>;
}) {
  const router = useRouter();
  // Which qualification track's queue we're reviewing. Tabs re-fetch on switch.
  const [track, setTrack] = useState<ReviewTrack>("infopreneur");
  // Local snapshot advanced by idx, so a background router.refresh() can't
  // reshuffle the list out from under the card mid-review. Stats (props) still
  // update live on refresh; new leads appear on the next full load. Mutated only
  // to re-queue an "unsure" lead to the end (doUnsure).
  const [items, setItems] = useState<ReviewLead[]>(queue);
  const [idx, setIdx] = useState(0);
  // Queue direction: "asc" = lowest score first (default — work up from the
  // borderline leads); "desc" = highest first (fast-track obvious keeps).
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Last acted-on lead id, so `u` can undo the most recent verdict.
  const lastActed = useRef<string | null>(null);
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
    lastActed.current = lead.id;
    start(async () => {
      const res = await approveLead(lead.id);
      if (!res.ok) return setError(res.error ?? "Could not approve.");
      advance();
      router.refresh();
    });
  }, [lead, pending, advance, router]);

  const doReject = useCallback(() => {
    if (!lead || pending) return;
    lastActed.current = lead.id;
    start(async () => {
      const res = await rejectLead(lead.id, reason);
      if (!res.ok) return setError(res.error ?? "Could not reject.");
      advance();
      router.refresh();
    });
  }, [lead, pending, reason, advance, router]);

  // "Unsure": defer this lead and re-queue it at the end of the local list, so
  // it comes back after the clear ones this session; deferLead persists that so
  // it also sorts last on reload. Not a decision — stats are untouched.
  const doUnsure = useCallback(() => {
    if (!lead || pending) return;
    const current = lead;
    lastActed.current = current.id;
    start(async () => {
      const res = await deferLead(current.id);
      if (!res.ok) return setError(res.error ?? "Could not defer.");
      setItems((its) => [...its, current]);
      advance();
    });
  }, [lead, pending, advance]);

  // First click reveals the reason picker (like keyboard `r`); the second
  // ("Confirm reject") commits — so a rejection always has a chosen reason.
  const onRejectClick = useCallback(() => {
    if (rejecting) {
      doReject();
    } else {
      setRejecting(true);
      setTimeout(() => reasonRef.current?.focus(), 0);
    }
  }, [rejecting, doReject]);

  // Flip the queue's score direction and reload it from the top.
  const changeOrder = useCallback(
    (next: "asc" | "desc") => {
      if (next === order || pending) return;
      setOrder(next);
      start(async () => {
        setItems(await getReviewQueue(100, next, track));
        setIdx(0);
        setRejecting(false);
        setReason("");
        setError(null);
        lastActed.current = null;
      });
    },
    [order, pending, track],
  );

  // Switch qualification track (Infopreneur / Partnership) and reload its queue.
  const changeTrack = useCallback(
    (next: ReviewTrack) => {
      if (next === track || pending) return;
      setTrack(next);
      start(async () => {
        setItems(await getReviewQueue(100, order, next));
        setIdx(0);
        setRejecting(false);
        setReason("");
        setError(null);
        lastActed.current = null;
      });
    },
    [track, order, pending],
  );

  const doUndo = useCallback(() => {
    const id = lastActed.current;
    if (!id || pending) return;
    start(async () => {
      const res = await undoReview(id);
      if (!res.ok) return setError(res.error ?? "Could not undo.");
      lastActed.current = null;
      // Reload the queue so the undone lead reappears at its scored position.
      router.refresh();
    });
  }, [pending, router]);

  // Keyboard-driven review: a approve, r open reject, j/k or arrows skip, u undo.
  // Ignored while typing a note so the shortcut letters don't hijack the field.
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
        case "s":
          e.preventDefault();
          doUnsure();
          break;
        case "j":
        case "k":
        case "arrowdown":
        case "arrowright":
          e.preventDefault();
          advance();
          break;
        case "u":
          e.preventDefault();
          doUndo();
          break;
        case "escape":
          if (rejecting) setRejecting(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doApprove, doReject, doUndo, doUnsure, advance, rejecting]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="inline-flex rounded-md border text-sm overflow-hidden">
        {(["infopreneur", "partnership"] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={pending}
            onClick={() => changeTrack(t)}
            className={cn(
              "px-3 py-1.5 transition-colors disabled:opacity-50",
              track === t ? "bg-accent font-medium" : "hover:bg-accent/50 text-muted-foreground",
            )}
          >
            {t === "infopreneur" ? "Infopreneur" : "Partnership"}
            <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{trackCounts[t]}</span>
          </button>
        ))}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {remaining} left to review · aim to keep under {(TARGET * 100).toFixed(0)}% marked bad
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
        <div className="flex gap-5">
          <StatBlock label="Last 7 days" stats={stats.last7} />
          <StatBlock label="All time" stats={stats.allTime} />
        </div>
      </div>

      {!lead ? (
        <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
          All caught up. {lastActed.current && "Press "}
          {lastActed.current && <kbd className="px-1 rounded border text-xs">u</kbd>}
          {lastActed.current && " to undo the last one, or reload for more."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className={cn("text-sm font-semibold tabular-nums rounded-md px-2 py-1", scoreColor(lead.overall_score))}>
                {lead.overall_score ?? "–"}
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
                {lead.niche && <Badge variant="outline" className="text-[10px]">{lead.niche}</Badge>}
                {lead.business_model && <Badge variant="secondary" className="text-[10px]">{lead.business_model}</Badge>}
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

            <div className="flex gap-4 text-xs text-muted-foreground tabular-nums">
              <span>{lead.followers?.toLocaleString() ?? "—"} followers</span>
              <span>{lead.engagement_rate != null ? `${(lead.engagement_rate * 100).toFixed(1)}%` : "—"} eng.</span>
              <span>{lead.posts_last_30_days ?? "—"} posts/30d</span>
            </div>

            {lead.reason_for_score && (
              <p className="text-xs text-muted-foreground border-l-2 pl-3 whitespace-pre-wrap">{lead.reason_for_score}</p>
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
            <Button variant="outline" className="flex-1" disabled={pending} onClick={doUnsure} title="Defer to end of queue">
              <HelpCircle className="h-4 w-4 mr-1.5" />
              Unsure <kbd className="ml-1.5 px-1 rounded bg-muted text-[10px]">s</kbd>
            </Button>
            <Button variant="ghost" size="icon" disabled={pending || !lastActed.current} onClick={doUndo} title="Undo last (u)">
              <Undo2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
