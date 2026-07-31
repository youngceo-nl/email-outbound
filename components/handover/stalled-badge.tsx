"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import { resumeAccountProcessing } from "@/app/actions/leads";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";

// How long the optimistic "processing" state holds before reverting to stalled
// if the server never confirms real activity — long enough to cover Apify
// latency on the first write, short enough that a truly dead resume comes clean.
const RESUMING_GRACE_MS = 3 * 60 * 1000;

/**
 * The "stalled" indicator on a handover account block. Opens on hover (and
 * click) into a small popover explaining what's stuck, with a button to
 * re-enqueue this account's outstanding backfill/scoring.
 *
 * On a successful resume it optimistically flips to a "processing" spinner
 * immediately — work is genuinely enqueued, and a fast backfill can finish
 * before the next server poll, so waiting for the poll would mean the operator
 * never sees it move. The parent unmounts this badge once the server reflects
 * the real state (processing, or done); if nothing actually happens within the
 * grace window it reverts to stalled, keeping the badge honest.
 */
export function StalledBadge({
  parentUsername,
  detail,
  onResumed,
}: {
  parentUsername: string;
  detail: string;
  onResumed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    [],
  );

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };

  const resume = () =>
    start(async () => {
      setError(null);
      const r = await resumeAccountProcessing(parentUsername);
      if (!r.ok) {
        setError(r.error ?? "Couldn't resume.");
        return;
      }
      // Enqueued — show processing right away and let the poll confirm.
      setResuming(true);
      setOpen(false);
      onResumed?.();
      if (graceTimer.current) clearTimeout(graceTimer.current);
      graceTimer.current = setTimeout(() => setResuming(false), RESUMING_GRACE_MS);
    });

  // Optimistic processing state — visually identical to the real "processing"
  // badge the parent renders once the server confirms, so the handoff is seamless.
  if (resuming) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        processing
        <InfoTip text="Resuming — leads are being processed again." />
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 cursor-pointer"
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
        >
          <AlertTriangle className="h-3 w-3" />
          stalled
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2" onMouseEnter={openNow} onMouseLeave={closeSoon}>
        <p className="text-xs text-muted-foreground">{detail}</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-full" disabled={pending} onClick={resume}>
          {pending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
          Resume processing
        </Button>
      </PopoverContent>
    </Popover>
  );
}
