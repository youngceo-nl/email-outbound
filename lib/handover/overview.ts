import { createAdminClient } from "@/lib/supabase/admin";
import { toClipboardText, type HandoverLead } from "@/lib/handover/format";
import { getScrapedSeedIds } from "@/lib/seeds/scraped";

/** Bucket for leads with no parent account — imports, manual adds, depth-0 rows. */
export const UNATTRIBUTED = "(unattributed)";

/** Read-only row preview cap — bounds render cost for accounts with a large pool. */
const PREVIEW_LIMIT = 50;

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
  /** Qualified leads from this account that need an email — the account's work.
   *  Displayed as the "ready for handover" funnel stage. */
  total: number;
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
   */
  stillProcessing: boolean;
  /** What exactly is still in flight — drives the "processing" badge's tooltip. */
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

  const [{ data: leads }, { data: batches }, { data: seeds }, scrapedIds, { data: counts }, { data: hardReasons }] = await Promise.all([
    // Qualified leads without an email are what handover exists to fix. Rows
    // already in a batch are included so an open batch still counts.
    sb
      .from("leads")
      .select(
        "id, username, full_name, niche, external_link, profile_url, bio, parent_username, handover_batch_id, handover_enriched_at, email",
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
  ]);

  type CountRow = {
    parent_username: string;
    total: number;
    backfilled: number;
    verified: number;
    pending_backfill: number;
    needs_filter: number;
    needs_verify: number;
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

      // Pool = eligible but not yet claimed into a batch — same definition as
      // claimBatch/getPoolCount in lib/handover/batch.ts.
      const pool = rows.filter((row) => !row.handover_batch_id).sort((a, b) => a.username.localeCompare(b.username));

      const c = countsByParent.get(key);
      const reasons = (reasonsByParent.get(key) ?? []).sort((a, b) => b.count - a.count);
      const hardFiltered = reasons.reduce((sum, r) => sum + r.count, 0);
      const outstanding = c ? c.pending_backfill + c.needs_filter + c.needs_verify : 0;

      return {
        parentUsername: key,
        username: key === UNATTRIBUTED ? "Unattributed (imports & manual)" : key,
        total: rows.length,
        done: rows.filter((row) => row.handover_enriched_at).length,
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
        stillProcessing: outstanding > 0,
        processing: {
          awaitingBackfill: c ? Number(c.pending_backfill) : 0,
          awaitingFilterScore: c ? Number(c.needs_filter) : 0,
          awaitingAiScore: c ? Number(c.needs_verify) : 0,
        },
      };
    })
    .sort((a, b) => b.total - a.total || a.username.localeCompare(b.username));
}
