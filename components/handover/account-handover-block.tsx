"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, Copy, Loader2 } from "lucide-react";
import { claimBatch, closeBatch } from "@/app/actions/handover";
import { BATCH_SIZE } from "@/lib/handover/format";
import { UNATTRIBUTED, hardFilterReasonLabel, type AccountHandover } from "@/lib/handover/overview";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import { MarkBadLeadButton } from "@/components/leads/mark-bad-lead-button";
import { StalledBadge } from "@/components/handover/stalled-badge";

export function AccountHandoverBlock({ account, onResumed }: { account: AccountHandover; onResumed?: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const {
    parentUsername, username, total, awaitingReview, done, openBatch, poolLeads, poolMore, stillProcessing,
    stalled, lastActivityAt, found, backfilled, hardFiltered, hardFilterReasons, aiScored, processing,
  } = account;
  // Claimable now = approved, no-email, not-yet-handed-over leads (= `total`,
  // "ready for handover"); `done` is a separate lifetime tally, so it can't be
  // subtracted here. Progress is share of all handover work already handed over.
  const remaining = total;
  const workTotal = total + awaitingReview + done;

  // "1865 followers too low · 853 engagement too low · …" for the tooltip.
  const hardFilterBreakdown = hardFilterReasons
    .map((r) => `${r.count.toLocaleString()} ${hardFilterReasonLabel(r.reason)}`)
    .join(" · ");

  // What the "processing" spinner is actually waiting on, for its tooltip.
  const processingBreakdown = [
    processing.awaitingBackfill > 0 && `${processing.awaitingBackfill.toLocaleString()} awaiting backfill (fetching followers/bio)`,
    processing.awaitingFilterScore > 0 && `${processing.awaitingFilterScore.toLocaleString()} awaiting filter & AI scoring`,
    processing.awaitingAiScore > 0 && `${processing.awaitingAiScore.toLocaleString()} awaiting AI scoring`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Same breakdown, but the work isn't moving — nothing has touched these leads
  // recently. Tell the operator what's stuck and how long, so a stalled run is
  // actionable (re-run Backfill) instead of a silent gap in the funnel.
  const stalledSince = lastActivityAt
    ? new Date(lastActivityAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;
  const stalledBreakdown =
    `${processingBreakdown || "leads still mid-pipeline"} — no activity since ${stalledSince ?? "a while ago"}. ` +
    `Run Backfill from the Leads page to finish these.`;

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Claim opens the batch server-side, then immediately copies its handles —
  // one click covers both "set this batch aside" and "put it on the
  // clipboard", so there's nothing extra to do before pasting into Clay.
  const claimAndCopy = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      const result = await claimBatch(parentUsername);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      await copyToClipboard(result.copyText);
    });

  const handleClose = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      const result = await closeBatch(parentUsername);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setNotice(
        result.returnedToPool
          ? `Batch closed. ${result.returnedToPool} lead(s) went back to the pool.`
          : "Batch closed.",
      );
    });

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">
              {parentUsername === UNATTRIBUTED ? username : `@${username}`}
            </span>
            {stillProcessing && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                processing
                <InfoTip text={processingBreakdown || "Leads still moving through the pipeline."} />
              </span>
            )}
            {stalled && <StalledBadge parentUsername={parentUsername} detail={stalledBreakdown} onResumed={onResumed} />}
            {openBatch && <Badge variant="secondary" className="text-[10px]">batch open</Badge>}
          </div>
          {/* Full pipeline funnel, absolute counts. Each stage is a subset of
              the one before it: found → backfilled → (hard-filtered drops out) →
              AI-scored → awaiting review → ready for handover → handed over. */}
          <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-muted-foreground tabular-nums">
            <Stat n={found} label="found" />
            <Stat n={backfilled} label="backfilled" />
            <span className="inline-flex items-center gap-1">
              <Stat n={hardFiltered} label="hard-filtered" />
              {hardFiltered > 0 && <InfoTip text={hardFilterBreakdown || "no breakdown available"} />}
            </span>
            <Stat n={aiScored} label="AI-scored" />
            {/* Gated stage: qualified leads can't be handed over until approved
                in Review. Amber + linked when any are waiting, so the reason
                "ready for handover" is low is visible and actionable. */}
            {awaitingReview > 0 ? (
              <Link href="/review" className="text-amber-600 dark:text-amber-400 hover:underline">
                <span className="font-medium">{awaitingReview.toLocaleString()}</span> awaiting review
              </Link>
            ) : (
              <Stat n={0} label="awaiting review" />
            )}
            <Stat n={total} label="ready for handover" highlight />
            <Stat n={done} label="handed over" />
          </div>
          <div className="mt-1.5 h-1 w-full max-w-xs rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: workTotal ? `${Math.min(100, (done / workTotal) * 100)}%` : "0%" }}
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {!openBatch ? (
            remaining === 0 ? (
              // Nothing ready to claim — say why rather than offering a dead
              // "Batch 0" button. Awaiting-review takes priority (it's the
              // actionable blocker), then a fully-handed-over account, then
              // still-processing, then genuinely empty.
              <span className="text-xs text-muted-foreground pr-1">
                {awaitingReview > 0
                  ? "review leads first"
                  : done > 0
                    ? "all handed over"
                    : stillProcessing
                      ? "no leads to enrich yet"
                      : "no leads to enrich"}
              </span>
            ) : (
              <Button size="sm" variant="outline" disabled={pending} onClick={claimAndCopy}>
                {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : null}
                {copied ? "Copied" : `Batch ${Math.min(remaining, BATCH_SIZE)}`}
              </Button>
            )
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => copyToClipboard(openBatch.copyText)}>
                {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                {copied ? "Copied" : "Copy again"}
              </Button>
              <Button size="sm" disabled={pending} onClick={handleClose}>
                Close
              </Button>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="p-1 rounded hover:bg-accent"
            aria-label={open ? "Hide leads" : "Show leads"}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
      {notice && <p className="px-3 pb-2 text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      {open && (
        <div className="border-t">
          {openBatch && (
            <div>
              <p className="px-3 pt-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                In this batch
              </p>
              <table className="w-full text-xs">
                <tbody>
                  {openBatch.leads.map((lead) => (
                    <tr key={lead.id} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-medium">{lead.username}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{lead.full_name ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        {lead.email ? (
                          <span className="text-emerald-600 dark:text-emerald-400">{lead.email}</span>
                        ) : lead.handover_enriched_at ? (
                          <span className="text-muted-foreground">no email found</span>
                        ) : (
                          <span className="text-muted-foreground">pending</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <MarkBadLeadButton leadId={lead.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Preview only — no actions here, just what's waiting in the pool. */}
          <div>
            <p className="px-3 pt-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Waiting in pool
            </p>
            {poolLeads.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Nothing waiting.</p>
            ) : (
              <ul className="divide-y">
                {poolLeads.map((lead) => (
                  <li key={lead.username} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <span className="font-medium shrink-0">@{lead.username}</span>
                    <span className="text-muted-foreground truncate">{lead.full_name ?? "—"}</span>
                  </li>
                ))}
              </ul>
            )}
            {poolMore > 0 && (
              <p className="px-3 py-1.5 text-[11px] text-muted-foreground">+{poolMore} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** One funnel stage: the count in foreground weight, the label muted after it. */
function Stat({ n, label, highlight }: { n: number; label: string; highlight?: boolean }) {
  return (
    <span>
      <span className={highlight ? "font-medium text-foreground" : "font-medium text-foreground/80"}>
        {n.toLocaleString()}
      </span>{" "}
      {label}
    </span>
  );
}
