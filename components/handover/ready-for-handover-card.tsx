"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { claimReadyBatch } from "@/app/actions/handover";
import { BATCH_SIZE } from "@/lib/handover/format";
import { Button } from "@/components/ui/button";

/**
 * Top-of-page dispatch card: every review-approved lead that still needs an
 * email, across all accounts, in one place with one copy button. "Copy all &
 * dispatch" claims them into per-account batches (so the returned CSV can be
 * matched back) and puts the combined handles on the clipboard; the page then
 * locks via DispatchLock until the enriched CSV is uploaded.
 */
export function ReadyForHandoverCard({
  readyCount,
  accountCount,
  preview,
  previewMore,
}: {
  readyCount: number;
  accountCount: number;
  preview: { username: string; full_name: string | null }[];
  previewMore: number;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const dispatch = () =>
    start(async () => {
      setError(null);
      setMessage(null);
      const res = await claimReadyBatch();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      try {
        await navigator.clipboard.writeText(res.copyText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* clipboard can fail without a user gesture / permissions — the batch is
           still claimed; DispatchLock offers a per-account Copy to retry. */
      }
      const accountPart = res.accounts === 1 ? "" : ` across ${res.accounts} accounts`;
      setMessage(
        `Dispatched ${res.claimed} lead${res.claimed === 1 ? "" : "s"}${accountPart}. Paste into Clay, then upload the enriched CSV.`,
      );
    });

  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Ready for handover</h2>
          {readyCount > 0 ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              {readyCount.toLocaleString()} approved lead{readyCount === 1 ? "" : "s"} without an email, across{" "}
              {accountCount} account{accountCount === 1 ? "" : "s"}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">
              Nothing ready yet.{" "}
              <Link href="/review" className="text-foreground underline hover:no-underline">
                Approve leads in Review
              </Link>{" "}
              to make them available for handover.
            </p>
          )}
        </div>
        {readyCount > 0 && (
          <Button size="sm" disabled={pending} onClick={dispatch} className="shrink-0">
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : copied ? (
              <Check className="h-3.5 w-3.5 mr-1.5" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1.5" />
            )}
            {copied ? "Copied" : `Batch ${Math.min(readyCount, BATCH_SIZE)}`}
          </Button>
        )}
      </div>

      {readyCount > 0 && preview.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {preview.map((l) => (
            <span key={l.username} className="truncate">@{l.username}</span>
          ))}
          {previewMore > 0 && <span>+{previewMore.toLocaleString()} more</span>}
        </div>
      )}

      {message && <p className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Copy className="h-3 w-3" />{message}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
