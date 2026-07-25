import type { Lead } from "@/lib/types";
import { compact, count, pct, reportDate } from "./format";
import type { SourceNote, Tier } from "./schema";

/*
 * A lead row, turned into the set of statements a report is allowed to make
 * about them.
 *
 * Two rules this file exists to enforce:
 *
 *   1. Nothing reaches the document without a source and a date. Every fact
 *      carries where it came from and when it was seen, which is what §0 and §10
 *      are generated from.
 *   2. Our own scoring never becomes a claim about the prospect. The lead scorer
 *      assigns icp_fit/traction/monetization/activity and an overall score —
 *      useful for deciding who gets a report, but telling a prospect "we rated
 *      you 78/100" is not a thing we do. Those live in internalSignals(), which
 *      informs the model's verdict and is never printed.
 */

export type Fact = {
  key: string;
  label: string;
  /** Print-ready. The renderer never formats. */
  display: string;
  /** Raw value, kept for the numeric validation gate in Phase 5. */
  value: number | string | null;
  tier: Tier;
  source: string;
  observedAt: string | null;
};

/** Instagram profile data is observed at the moment the row was last refreshed. */
function igSource(lead: Lead): string {
  return `Public Instagram profile @${lead.username}, ${reportDate(lead.updated_at)}`;
}

function offerSource(lead: Lead): string {
  const where = lead.funnel_platform ? `their ${lead.funnel_platform} page` : "their linked offer page";
  const when = lead.funnel_extracted_at ? `, ${reportDate(lead.funnel_extracted_at)}` : "";
  return `${where}${when}`;
}

function fact(
  key: string,
  label: string,
  value: number | string | null,
  display: string,
  source: string,
  observedAt: string | null,
): Fact {
  return { key, label, value, display, tier: "observed", source, observedAt };
}

/**
 * Everything the report may state as observed fact.
 *
 * Null and zero are skipped rather than rendered as "0" or "—": a missing
 * engagement rate means we did not measure it, which is different from measuring
 * it at zero, and printing the latter would be a false claim.
 */
export function leadFacts(lead: Lead): Fact[] {
  const facts: Fact[] = [];
  const ig = igSource(lead);
  const at = lead.updated_at;

  if (lead.followers) facts.push(fact("followers", "Followers", lead.followers, compact(lead.followers), ig, at));
  if (lead.posts) facts.push(fact("posts", "Total posts", lead.posts, count(lead.posts), ig, at));
  if (lead.engagement_rate) {
    facts.push(fact("engagement_rate", "Engagement rate", lead.engagement_rate, pct(lead.engagement_rate, 2), ig, at));
  }
  if (lead.avg_likes) facts.push(fact("avg_likes", "Average likes", lead.avg_likes, count(lead.avg_likes), ig, at));
  if (lead.avg_comments) {
    facts.push(fact("avg_comments", "Average comments", lead.avg_comments, count(lead.avg_comments), ig, at));
  }
  if (lead.avg_views) facts.push(fact("avg_views", "Average views", lead.avg_views, count(lead.avg_views), ig, at));
  if (lead.posts_last_30_days !== null) {
    facts.push(
      fact("posts_last_30_days", "Posts in the last 30 days", lead.posts_last_30_days, count(lead.posts_last_30_days), ig, at),
    );
  }
  if (lead.reels_last_30_days !== null) {
    facts.push(
      fact("reels_last_30_days", "Reels in the last 30 days", lead.reels_last_30_days, count(lead.reels_last_30_days), ig, at),
    );
  }
  if (lead.activity_status) {
    facts.push(fact("activity_status", "Posting cadence", lead.activity_status, ACTIVITY_LABEL[lead.activity_status], ig, at));
  }
  if (lead.is_verified) facts.push(fact("verified", "Verified account", true as unknown as string, "Yes", ig, at));

  // Classification is the model's reading of public signals, not a measurement —
  // but it is a reading of *their* public material, so it belongs in the document
  // as long as it is not dressed up as a metric.
  if (lead.niche) facts.push(fact("niche", "Category", lead.niche, lead.niche, ig, at));
  if (lead.business_model) facts.push(fact("business_model", "Business model", lead.business_model, lead.business_model, ig, at));
  if (lead.offer_type) facts.push(fact("offer_type", "Offer type", lead.offer_type, lead.offer_type, ig, at));
  if (lead.audience_type) facts.push(fact("audience_type", "Audience", lead.audience_type, lead.audience_type, ig, at));

  // Offer page — a different source with its own date.
  const offer = offerSource(lead);
  if (lead.funnel_program_name) {
    facts.push(
      fact("funnel_program_name", "Current offer", lead.funnel_program_name, lead.funnel_program_name, offer, lead.funnel_extracted_at),
    );
  }
  if (lead.funnel_offer_summary) {
    facts.push(
      fact("funnel_offer_summary", "Offer description", lead.funnel_offer_summary, lead.funnel_offer_summary, offer, lead.funnel_extracted_at),
    );
  }
  if (lead.funnel_price) {
    facts.push(fact("funnel_price", "Listed price", lead.funnel_price, lead.funnel_price, offer, lead.funnel_extracted_at));
  }
  if (lead.funnel_platform) {
    facts.push(fact("funnel_platform", "Funnel platform", lead.funnel_platform, lead.funnel_platform, offer, lead.funnel_extracted_at));
  }

  return facts;
}

const ACTIVITY_LABEL: Record<NonNullable<Lead["activity_status"]>, string> = {
  very_active: "Very active",
  active: "Active",
  semi_active: "Semi-active",
  inactive: "Inactive",
};

/**
 * Internal triage signals. Never rendered.
 *
 * Kept separate so it is structurally impossible to leak our scoring into a
 * prospect-facing document by adding a field in the wrong place.
 */
export type InternalSignals = {
  overallScore: number | null;
  icpFit: number | null;
  traction: number | null;
  monetization: number | null;
  activity: number | null;
  reasonForScore: string | null;
  recommendedAction: string | null;
};

export function internalSignals(lead: Lead): InternalSignals {
  return {
    overallScore: lead.overall_score,
    icpFit: lead.icp_fit_score,
    traction: lead.traction_score,
    monetization: lead.monetization_score,
    activity: lead.activity_score,
    reasonForScore: lead.reason_for_score,
    recommendedAction: lead.recommended_action,
  };
}

/**
 * §10's source-notes table, collapsed from the fact set.
 *
 * Grouped by source so the table lists each place we looked once, with what it
 * was used for — the reference report's own format.
 */
export function sourceNotesFrom(facts: Fact[]): SourceNote[] {
  const bySource = new Map<string, string[]>();
  for (const f of facts) {
    const list = bySource.get(f.source) ?? [];
    list.push(f.label.toLowerCase());
    bySource.set(f.source, list);
  }

  return [...bySource.entries()].map(([source, labels]) => ({
    source,
    usedFor: `${labels.slice(0, 4).join(", ")}${labels.length > 4 ? `, and ${labels.length - 4} more` : ""}.`,
  }));
}

/**
 * What we could not see. Feeds §0's known limits alongside the assumption-derived
 * ones from resolveAssumptions.
 *
 * Stated as facts about our access rather than about the prospect: "no analytics
 * access" is true and checkable, "they have no traffic" would be neither.
 */
export function accessLimitations(lead: Lead): string[] {
  const limits: string[] = [
    "This uses public information only. No analytics, ad account, email list, or customer data was accessed.",
  ];

  if (lead.is_private) {
    limits.push("The account is private, so post-level engagement could not be measured.");
  }
  if (!lead.engagement_rate) {
    limits.push("Engagement rate could not be measured from the posts available at the time of review.");
  }
  if (!lead.external_link) {
    limits.push("No link was published in the profile bio, so no offer or pricing page could be reviewed.");
  } else if (!lead.funnel_extracted_at) {
    limits.push("The linked page has not been reviewed yet, so the current offer and price are unconfirmed.");
  }
  if (!lead.funnel_price) {
    limits.push("No public price was found, so the offer price used in the projections is an assumption.");
  }
  return limits;
}
