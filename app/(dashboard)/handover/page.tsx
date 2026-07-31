import { getBatchHistory } from "@/lib/handover/batches";
import { getHandoverOutcomesByParent } from "@/lib/handover/outcomes";
import { getAccountHandoverStats } from "@/lib/handover/overview";
import { BatchHistory } from "@/components/handover/batch-history";
import { HandoverSection } from "@/components/handover/handover-section";
import { ReadyForHandoverCard } from "@/components/handover/ready-for-handover-card";
import { DispatchLock } from "@/components/handover/dispatch-lock";

const READY_PREVIEW = 12;

export const dynamic = "force-dynamic";

export default async function HandoverPage() {
  const [allBatches, outcomes, handoverAccounts] = await Promise.all([
    getBatchHistory(),
    getHandoverOutcomesByParent(),
    // Empty rather than fatal, matching how the Leads page fetched this.
    getAccountHandoverStats().catch(() => []),
  ]);

  // Only batches that actually came back with results. A closed batch's linked
  // leads are exactly its returned (enriched) ones — un-enriched leads detach on
  // close — so `total > 0` means it returned. This drops open batches (still out
  // with Clay, surfaced by the dispatch lock instead) and empty
  // canceled/superseded batches, which never really left the source account.
  const batches = allBatches.filter((b) => b.status === "closed" && b.total > 0);

  // All review-approved, no-email, unclaimed leads across accounts — the pool the
  // top card copies & dispatches in one click. `total` is that ready count and
  // `poolLeads` its preview (both from getAccountHandoverStats, already gated).
  const readyCount = handoverAccounts.reduce((sum, a) => sum + a.total, 0);
  const readyAccountCount = handoverAccounts.filter((a) => a.total > 0).length;
  const readyPreviewAll = handoverAccounts.flatMap((a) => a.poolLeads);
  const readyPreview = readyPreviewAll.slice(0, READY_PREVIEW);
  const readyPreviewMore = Math.max(0, readyCount - readyPreview.length);

  // Accounts that have ever had a handover result, most-active first — the
  // per-account rollup carries the marked-bad count the per-batch view can't
  // (bad leads get detached from their batch).
  const accounts = [...outcomes.entries()]
    .map(([parentUsername, o]) => ({ parentUsername, ...o }))
    .filter((a) => a.accepted + a.noEmail + a.markedBad > 0)
    .sort((a, b) => b.accepted + b.noEmail + b.markedBad - (a.accepted + a.noEmail + a.markedBad));

  return (
    <div className="relative">
      {/* absolute, not fixed — covers this page's content only, not the sidebar.
          While a batch is out with Clay this greys the page and shows the
          upload/copy/cancel modal, clearing once the enriched CSV is uploaded. */}
      <DispatchLock />
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Enrich Emails</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send leads out for email lookup, upload the results, and track what came back. Leads
            with an email land on Outreach Ready; leads flagged bad are counted per account below.
          </p>
        </div>

        <ReadyForHandoverCard
          readyCount={readyCount}
          accountCount={readyAccountCount}
          preview={readyPreview}
          previewMore={readyPreviewMore}
        />

        <HandoverSection initial={handoverAccounts} />

        {accounts.length > 0 && (
          <div className="rounded-md border divide-y">
            {accounts.map((a) => (
              <div key={a.parentUsername} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="font-medium truncate">@{a.parentUsername}</span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 flex gap-3">
                  <span>
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">{a.accepted}</span> email
                  </span>
                  <span>
                    <span className="font-medium text-foreground/80">{a.noEmail}</span> no email
                  </span>
                  <span>
                    <span className="font-medium text-destructive">{a.markedBad}</span> marked bad
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Rounds</h2>
          <BatchHistory batches={batches} />
        </div>
      </div>
    </div>
  );
}
