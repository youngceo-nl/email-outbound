import { createAdminClient } from "@/lib/supabase/admin";
import { toClipboardText, type HandoverLead } from "@/lib/handover/format";
import { getScrapedSeedIds } from "@/lib/seeds/scraped";

/** Bucket for leads with no parent account — imports, manual adds, depth-0 rows. */
export const UNATTRIBUTED = "(unattributed)";

/** Read-only row preview cap — bounds render cost for accounts with a large pool. */
const PREVIEW_LIMIT = 50;

/**
 * How recently an in-flight lead must have been touched for the account to
 * count as *actively* processing rather than stalled. The touch_leads trigger
 * bumps updated_at on every write, so an active backfill/scoring run keeps this
 * fresh; a run that stopped (or leads that were discovered but never enqueued)
 * goes stale and is reported as stalled, not processing.
 */
const ACTIVITY_WINDOW_MS = 30 * 60 * 1000;

export type HardFilterReason = { reason: string; count: number };

/** Turn a raw filter reason (lib/pipeline/filter.ts) into plain language for the tooltip. */
export function hardFilterReasonLabel(reason: string): string {
  const map: Record<string, string> = {
    followers_below_min: "followers too low",
    followers_above_max: "followers too high",
    engagement_below_min: "engagement too low",
    reels_30d_below_min: "too few recent reels",
    no_recent_posts: "no recent posts",
    no_bio: "no bio",
    private_account: "private account",
    junk_keyword_in_bio: "junk words in bio",
    no_include_keyword_match: "no keyword match",
  };
  if (map[reason]) return map[reason];
  // "excluded_keyword:fan" -> "excluded keyword: fan"
  if (reason.startsWith("excluded_keyword:")) return `excluded keyword: ${reason.slice("excluded_keyword:".length)}`;
  return reason.replace(/_/g, " ");
}

export type AccountHandover = {
  /** parent_username, or UNATTRIBUTED. The key batches are opened against. */
  parentUsername: string;
  username: string;
  /** Approved, qualified leads from this account that need an email — the
   *  claimable work. Displayed as the "ready for handover" funnel stage. */
  total: number;
  /** Qualified no-email leads still awaiting manual review — they can't be
   *  handed over until approved (the review gate). The "in manual scoring" stage. */
  awaitingReview: number;
  /** Of those, how many have been through a handover batch. Displayed as "handed over". */
  done: number;
  // ── Pipeline funnel, all absolute counts, sourced from lead_counts_by_parent
  //    + hard_filter_reasons_by_parent. These make the scrape → backfill → score
  //    pipeline visible on the card instead of only the final handover pool, so
  //    a fresh scrape reads as "3000 backfilled · 200 AI-scored" rather than a
  //    mystifying "0/0" that sits flat until scoring finally produces a lead.
  /** All leads discovered from this account (the funnel's starting width). */
  found: number;
  /** Of those, how many have profile metadata (followers etc.) filled in. */
  backfilled: number;
  /** Dropped by the cheap hard/metrics filters *before* AI — never scored. */
  hardFiltered: number;
  /** Why those were dropped — for the hard-filtered stage's hover tooltip. */
  hardFilterReasons: HardFilterReason[];
  /** Reached AI classification (any outcome: qualified, review, or AI-rejected). */
  aiScored: number;
  openBatch: {
    id: string;
    leads: (HandoverLead & { handover_enriched_at: string | null; email: string | null })[];
    copyText: string;
  } | null;
  /** Read-only preview of the pool for the expandable row — not the whole thing past PREVIEW_LIMIT. */
  poolLeads: { username: string; full_name: string | null }[];
  poolMore: number;
  /**
   * True when this account still has leads mid-pipeline (awaiting backfill,
   * filtering, or AI scoring) — so a `0` ready count can be told apart from
   * "nothing here" vs. "still working through a fresh scrape." A seed's
   * crawl_jobs row can already read `completed` while backfill/scoring for
   * its leads runs on for a long time afterward as a separate Inngest chain,
   * so crawl status alone can't answer this.
   *
   * Gated on *recent activity*, not just the presence of in-flight leads: a
   * process is only "processing" if it's actually touching leads (see
   * ACTIVITY_WINDOW_MS). Leads discovered but never backfilled read as
   * `stalled` instead, not a perpetual spinner.
   */
  stillProcessing: boolean;
  /** Outstanding in-flight work exists, but nothing has touched it recently —
   *  a stopped/orphaned run that needs a manual backfill kick, not active work. */
  stalled: boolean;
  /** Newest touch across the in-flight leads, for the stalled tooltip. */
  lastActivityAt: string | null;
  /** What exactly is still in flight — drives the badge tooltips. */
  processing: {
    /** Backfilled?no — waiting on metadata (followers/bio/…). */
    awaitingBackfill: number;
    /** Backfilled, not yet through the hard/metrics filter + AI classify step. */
    awaitingFilterScore: number;
    /** Passed the pre-filter, waiting on AI scoring specifically. */
    awaitingAiScore: number;
  };
};

/**
 * One row per account whose following list produced leads, for the blocks on
 * the leads page.
 *
 * Grouped by `parent_username`, not `source_seed_id`. The latter means "the
 * seed this discovery traces back to" and survives recursion into other
 * accounts, so it reported @pierree as the source of 1039 leads when only 461
 * were his followings — the rest came from recursing into @bridger_rogers.
 *
 * `done` counts leads that have been *through* handover, not leads with an
 * email: Clay finds nothing for plenty of accounts, and this number shows how
 * far along an account is, not how well enrichment performed.
 */
export async function getAccountHandoverStats(): Promise<AccountHandover[]> {
  const sb = createAdminClient();

  const [{ data: leads }, { data: batches }, { data: seeds }, scrapedIds, { data: counts }, { data: hardReasons }, { data: handedOver }] = await Promise.all([
    // Qualified leads without an email are what handover exists to fix. Rows
    // already in a batch are included so an open batch still counts.
    // Fetched *ungated* by review verdict so the funnel can show the real
    // pipeline — `review_decision` is selected and split in JS: approved →
    // "ready for handover" (the claimable set, matching the gate in batch.ts),
    // unreviewed → "awaiting review". Only the ready count and the claim itself
    // are gated; the display tells the truth (docs/KPI/scoring-improvement.md).
    sb
      .from("leads")
      .select(
        "id, username, full_name, niche, external_link, profile_url, bio, parent_username, handover_batch_id, handover_enriched_at, email, review_decision",
      )
      .eq("status", "qualified")
      .is("email", null)
      .is("email_v2", null),
    sb.from("handover_batches").select("id, parent_username").eq("status", "open"),
    sb.from("seeds").select("id, username"),
    getScrapedSeedIds(),
    // The Activity page's seed pipeline aggregate — reused here for the funnel
    // (total/backfilled/verified) and stillProcessing (pending/needs_*).
    sb.rpc("lead_counts_by_parent"),
    // Per-account "why were these dropped before AI" breakdown for the
    // hard-filtered stage's hover tooltip.
    sb.rpc("hard_filter_reasons_by_parent"),
    // Every lead ever handed over (through a Clay batch), for the true "handed
    // over" tally — counted regardless of email or review, since it's history.
    // Kept separate from the no-email pool query above, which excludes leads
    // that came back with an email (they've left the funnel onto Outreach Ready).
    sb.from("leads").select("parent_username").not("handover_enriched_at", "is", null),
  ]);

  const handedOverByParent = new Map<string, number>();
  for (const row of handedOver ?? []) {
    const key = row.parent_username ?? UNATTRIBUTED;
    handedOverByParent.set(key, (handedOverByParent.get(key) ?? 0) + 1);
  }

  type CountRow = {
    parent_username: string;
    total: number;
    backfilled: number;
    verified: number;
    pending_backfill: number;
    needs_filter: number;
    needs_verify: number;
    last_inflight_activity: string | null;
  };
  const countsByParent = new Map(((counts ?? []) as CountRow[]).map((r) => [r.parent_username, r]));

  type ReasonRow = { parent_username: string; reason: string; count: number };
  const reasonsByParent = new Map<string, HardFilterReason[]>();
  for (const r of (hardReasons ?? []) as ReasonRow[]) {
    const list = reasonsByParent.get(r.parent_username) ?? [];
    list.push({ reason: r.reason, count: Number(r.count) });
    reasonsByParent.set(r.parent_username, list);
  }

  type Row = NonNullable<typeof leads>[number];
  const bySeed = new Map<string, Row[]>();
  for (const lead of leads ?? []) {
    const key = lead.parent_username ?? UNATTRIBUTED;
    const list = bySeed.get(key);
    if (list) list.push(lead);
    else bySeed.set(key, [lead]);
  }

  // Every scraped seed gets a block even with an empty pool — otherwise a
  // scraped account that produced nothing is indistinguishable from one that
  // was never scraped.
  const keys = new Set(bySeed.keys());
  for (const seed of seeds ?? []) if (scrapedIds.has(seed.id)) keys.add(seed.username);

  const openByParent = new Map((batches ?? []).map((batch) => [batch.parent_username, batch.id]));

  return [...keys]
    .map((key) => {
      const rows = bySeed.get(key) ?? [];
      const batchId = openByParent.get(key) ?? null;
      const batchLeads = batchId ? rows.filter((row) => row.handover_batch_id === batchId) : [];

      // Leads still needing handover (no email, not yet run through Clay). Those
      // already handed over are counted separately (handedOverByParent) so they
      // don't show up as "awaiting review" or "ready" again.
      const notHandedOver = rows.filter((row) => !row.handover_enriched_at);

      // Pool = eligible but not yet claimed into a batch — same definition as
      // claimBatch/getPoolCount in lib/handover/batch.ts, including the review
      // gate (only approved leads are actually claimable).
      const pool = notHandedOver
        .filter((row) => !row.handover_batch_id && row.review_decision === "approved")
        .sort((a, b) => a.username.localeCompare(b.username));

      // Approved & no-email = ready to claim; unreviewed = still in manual scoring.
      const readyForHandover = notHandedOver.filter((row) => row.review_decision === "approved").length;
      const awaitingReview = notHandedOver.filter((row) => !row.review_decision).length;
      const done = handedOverByParent.get(key) ?? 0;

      const c = countsByParent.get(key);
      const reasons = (reasonsByParent.get(key) ?? []).sort((a, b) => b.count - a.count);
      const hardFiltered = reasons.reduce((sum, r) => sum + r.count, 0);
      const outstanding = c ? c.pending_backfill + c.needs_filter + c.needs_verify : 0;
      // Only "processing" if a job is actually touching these leads recently;
      // otherwise the outstanding work is stalled (a stopped run, or leads that
      // were discovered but never enqueued for backfill).
      const lastActivity = c?.last_inflight_activity ? Date.parse(c.last_inflight_activity) : 0;
      const activelyProcessing = outstanding > 0 && Date.now() - lastActivity < ACTIVITY_WINDOW_MS;

      return {
        parentUsername: key,
        username: key === UNATTRIBUTED ? "Unattributed (imports & manual)" : key,
        total: readyForHandover,
        awaitingReview,
        done,
        found: c ? Number(c.total) : rows.length,
        backfilled: c ? Number(c.backfilled) : 0,
        hardFiltered,
        hardFilterReasons: reasons,
        aiScored: c ? Number(c.verified) : 0,
        openBatch: batchId
          ? {
              id: batchId,
              leads: batchLeads.sort((a, b) => a.username.localeCompare(b.username)),
              // Built here so the block's copy button is a plain clipboard
              // write with nothing to fetch or fail at click time.
              copyText: toClipboardText(batchLeads),
            }
          : null,
        poolLeads: pool.slice(0, PREVIEW_LIMIT).map((row) => ({ username: row.username, full_name: row.full_name })),
        poolMore: Math.max(0, pool.length - PREVIEW_LIMIT),
        stillProcessing: activelyProcessing,
        stalled: outstanding > 0 && !activelyProcessing,
        lastActivityAt: c?.last_inflight_activity ?? null,
        processing: {
          awaitingBackfill: c ? Number(c.pending_backfill) : 0,
          awaitingFilterScore: c ? Number(c.needs_filter) : 0,
          awaitingAiScore: c ? Number(c.needs_verify) : 0,
        },
      };
    })
    .sort((a, b) => b.total - a.total || a.username.localeCompare(b.username));
}
