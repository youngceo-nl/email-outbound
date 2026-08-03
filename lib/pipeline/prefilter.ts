/*
 * The bio-link pre-filter — spec docs/testruns/tasks.md, C1.
 *
 * Steel acquisition is the pipeline's hardest throttle: one lead at a time
 * behind a 180s browser session. A lead with no bio link has no landing page to
 * crawl and no funnel to read, so it spends a full session to arrive at an
 * answer we could have had from a batched Apify call. Across the two 2026-08-02
 * runs, 7 of 20 leads had no bio link and not one of them qualified.
 *
 * The decision lives here, apart from the Inngest function, because the part
 * worth testing is the partition — not the event plumbing around it.
 */

import type { ScrapedProfile } from "@/lib/types";

export type PrefilterLead = { id: string; username: string };

export type PrefilterPartition = {
  /** Goes on to Steel. */
  acquire: PrefilterLead[];
  /** Dropped: the actor returned the profile and it carries no bio link. */
  skipped: PrefilterLead[];
};

/**
 * Splits a run's leads on whether Apify saw a bio link.
 *
 * Fails open, and that is the whole design. A username the actor did not return
 * is unknown, not linkless — the run may have hit a rate limit, an over-limit
 * token, or a profile the actor simply could not read. Those leads go to Steel.
 * Only a profile we positively received and positively saw no link on is
 * dropped, which mirrors the absent-vs-unknown distinction the evidence layer
 * already draws (lib/evidence/instagram.ts:165). A cheap filter that breaks must
 * cost money, never leads.
 */
export function partitionByBioLink(
  leads: readonly PrefilterLead[],
  profiles: readonly ScrapedProfile[],
): PrefilterPartition {
  const linkByUsername = new Map(
    profiles.map((p) => [p.username.toLowerCase(), (p.external_link ?? "").trim()]),
  );

  const acquire: PrefilterLead[] = [];
  const skipped: PrefilterLead[] = [];

  for (const lead of leads) {
    const link = linkByUsername.get(lead.username.toLowerCase());
    if (link === undefined) {
      acquire.push(lead); // never returned — unknown, so give it the benefit
    } else if (link === "") {
      skipped.push(lead);
    } else {
      acquire.push(lead);
    }
  }

  return { acquire, skipped };
}

/**
 * Apify runs one actor per call, so a 500-lead run is a single all-or-nothing
 * request unless it is split. 50 keeps a failure cheap while staying well inside
 * the actor's comfortable batch size.
 */
export const PREFILTER_CHUNK = 50;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Recorded on the skipped lead so the drop is auditable and reversible. */
export const PREFILTER_REJECTION_REASON = "no_bio_link";
