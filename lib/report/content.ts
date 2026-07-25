import type { Lead, RecentPost } from "@/lib/types";
import { compact, count, pct } from "./format";

/*
 * Content analysis from the last ~12 scraped posts.
 *
 * This data was already being collected and stored on every lead and then never
 * looked at — captions, likes, comments, views, reel flag and timestamps sitting
 * in recent_posts while the report talked only about follower totals. It is the
 * most persuasive material available, because a prospect recognises their own
 * best post and immediately trusts the rest of the document more.
 *
 * Everything here is measured from what was scraped. Nothing is inferred, and a
 * missing signal produces no claim rather than a zero.
 */

export type PostPerformance = {
  /** Trimmed caption opener, for identifying the post without reprinting it whole. */
  hook: string;
  isReel: boolean;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** likes + comments. The comparable number across reels and static posts. */
  engagement: number;
  takenAt: string | null;
};

export type ContentAnalysis = {
  postsAnalysed: number;
  top: PostPerformance[];
  reels: { count: number; averageEngagement: number; averageViews: number | null };
  statics: { count: number; averageEngagement: number };
  medianEngagement: number;
  /** Top post over median. High means one-off spikes; near 1 means consistency. */
  spikeRatio: number;
  /** Which format earns more engagement per post, when both exist in the sample. */
  strongerFormat: "reels" | "static" | "comparable" | null;
};

function engagementOf(post: RecentPost): number {
  return (post.likes ?? 0) + (post.comments ?? 0);
}

/** First clause of a caption — enough to recognise the post, short enough for a table cell. */
function hookOf(post: RecentPost): string {
  const caption = (post.caption ?? "").replace(/\s+/g, " ").trim();
  if (!caption) return "(no caption)";
  const cut = caption.slice(0, 70);
  return caption.length > 70 ? `${cut.replace(/\s\S*$/, "")}…` : cut;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

export function analyseContent(lead: Lead): ContentAnalysis | null {
  // Pinned posts sit at the top of a profile regardless of recency or
  // performance, so including them would misrepresent both cadence and the
  // top-post ranking.
  const posts = (lead.recent_posts ?? []).filter((post) => !post.is_pinned);
  if (posts.length === 0) return null;

  const engagements = posts.map(engagementOf);
  // Every post scraped with zero likes and zero comments means the scrape did not
  // capture engagement, not that the account has none — no claim either way.
  if (engagements.every((value) => value === 0)) return null;

  const reels = posts.filter((post) => post.is_reel);
  const statics = posts.filter((post) => !post.is_reel);

  const reelEngagement = mean(reels.map(engagementOf));
  const staticEngagement = mean(statics.map(engagementOf));
  const reelViews = reels.map((post) => post.views).filter((v): v is number => typeof v === "number" && v > 0);

  const med = median(engagements);
  const top = [...posts]
    .sort((a, b) => engagementOf(b) - engagementOf(a))
    .slice(0, 3)
    .map<PostPerformance>((post) => ({
      hook: hookOf(post),
      isReel: Boolean(post.is_reel),
      likes: post.likes,
      comments: post.comments,
      views: post.views,
      engagement: engagementOf(post),
      takenAt: post.taken_at,
    }));

  let strongerFormat: ContentAnalysis["strongerFormat"] = null;
  if (reels.length > 0 && statics.length > 0) {
    const ratio = reelEngagement / (staticEngagement || 1);
    // Within 20% is noise at this sample size, not a finding.
    strongerFormat = ratio > 1.2 ? "reels" : ratio < 0.8 ? "static" : "comparable";
  }

  return {
    postsAnalysed: posts.length,
    top,
    reels: {
      count: reels.length,
      averageEngagement: reelEngagement,
      averageViews: reelViews.length > 0 ? mean(reelViews) : null,
    },
    statics: { count: statics.length, averageEngagement: staticEngagement },
    medianEngagement: med,
    spikeRatio: med > 0 ? (top[0]?.engagement ?? 0) / med : 0,
    strongerFormat: strongerFormat,
  };
}

/**
 * The strategic read on the analysis.
 *
 * Deliberately hedged where the sample is thin: twelve posts is enough to see a
 * format difference or a spike pattern, and not enough to claim a trend. Saying
 * so is what makes the rest of the section credible.
 */
export function contentObservations(analysis: ContentAnalysis, lead: Lead): string[] {
  const notes: string[] = [];

  if (analysis.strongerFormat === "reels") {
    notes.push(
      `Reels out-earn static posts on engagement in this sample (${count(analysis.reels.averageEngagement)} versus ${count(analysis.statics.averageEngagement)} per post), which is the format a registration campaign should lead with.`,
    );
  } else if (analysis.strongerFormat === "static") {
    notes.push(
      `Static posts out-earn reels here (${count(analysis.statics.averageEngagement)} versus ${count(analysis.reels.averageEngagement)} per post), so promotion should not be reel-only.`,
    );
  } else if (analysis.strongerFormat === "comparable") {
    notes.push("Reels and static posts perform comparably, so format is not the constraint — the offer and the hook are.");
  }

  if (analysis.spikeRatio >= 3) {
    notes.push(
      `The best post earned ${analysis.spikeRatio.toFixed(1)}x the median, so reach is spike-driven rather than steady. A launch should not depend on catching a spike, which is the argument for a dated event and paid support.`,
    );
  } else if (analysis.spikeRatio > 0 && analysis.spikeRatio < 1.8) {
    notes.push(
      "Engagement is consistent across recent posts rather than spike-driven, which makes organic promotion of a dated event more predictable.",
    );
  }

  if (analysis.reels.averageViews && lead.followers) {
    const reach = analysis.reels.averageViews / lead.followers;
    notes.push(
      `Reels average ${compact(analysis.reels.averageViews)} views against ${compact(lead.followers)} followers (${pct(reach)}). Views are not registrations, but they show the reach a launch announcement can borrow.`,
    );
  }

  notes.push(
    `Measured from the ${analysis.postsAnalysed} most recent non-pinned posts captured at the time of review — enough to read format and consistency, not enough to establish a trend.`,
  );

  return notes;
}
