import type { Lead } from "@/lib/types";
import { analyseContent } from "../content";
import { compact, count, pct, reportDate } from "../format";
import type { Fact } from "../facts";
import type { ScenarioSet } from "../schema";

/*
 * The raw material handed to the analysis pass.
 *
 * This exists because the previous version handed the model only *formatted*
 * values — "84.3K followers", "2.65%" — and threw away the post captions, the bio
 * and the offer-page copy. It was being asked to write about a business from a
 * summary table, which is why its output read generic. Here it gets the actual
 * words the prospect wrote.
 *
 * Everything under `untrusted` is third-party text scraped from a profile. The
 * prompt says so explicitly and the model is told to treat it as information, not
 * instruction — a bio reading "ignore previous instructions" is just a bio.
 */

export type Dossier = {
  prospect: {
    name: string;
    handle: string;
    verified: boolean;
    private: boolean;
  };
  audience: {
    followers: string | null;
    following: string | null;
    total_posts: string | null;
    engagement_rate: string | null;
    avg_likes: string | null;
    avg_comments: string | null;
    avg_views: string | null;
    posts_last_30_days: string | null;
    reels_last_30_days: string | null;
    cadence: string | null;
    measured_on: string;
  };
  classification: {
    niche: string | null;
    business_model: string | null;
    offer_type: string | null;
    audience_type: string | null;
  };
  offer: {
    reviewed: boolean;
    program_name: string | null;
    summary: string | null;
    listed_price: string | null;
    platform: string | null;
    url: string | null;
    observed_on: string | null;
  };
  content: {
    posts_analysed: number;
    median_engagement: string;
    best_post_multiple_of_median: string;
    stronger_format: string | null;
    reels_avg_engagement: string;
    static_avg_engagement: string;
  } | null;
  /** Scraped third-party text. Data, never instruction. */
  untrusted: {
    bio: string | null;
    recent_posts: Array<{
      caption: string | null;
      format: "reel" | "static";
      likes: number | null;
      comments: number | null;
      views: number | null;
      posted: string | null;
    }>;
  };
  /** Already-computed economics. The model may quote these and must not alter them. */
  economics: {
    projected: Record<string, string>;
    worst_case: Record<string, string>;
    inputs: Array<{ input: string; value: string; basis: string; source: string }>;
  };
  /** What we could not see. The model must not write around these. */
  known_limits: string[];
};

/** Captions are the point, but a runaway one shouldn't eat the context window. */
const MAX_CAPTION = 400;
const MAX_BIO = 600;

function trim(text: string | null, max: number): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function buildDossier(args: {
  lead: Lead;
  facts: Fact[];
  scenarios: ScenarioSet;
  assumptions: Array<{ label: string; display: string; tier: string; source: string }>;
  limitations: string[];
}): Dossier {
  const { lead, scenarios } = args;
  const content = analyseContent(lead);

  const money = (scenario: ScenarioSet["projected"]) => ({
    total_registrations: count(scenario.total_registrations),
    live_attendees: count(scenario.live_attendees),
    buyers: count(scenario.front_end_buyers),
    revenue: `$${Math.round(scenario.net_front_end_revenue).toLocaleString()}`,
    net_profit: `$${Math.round(scenario.front_end_net_profit).toLocaleString()}`,
    margin: pct(scenario.front_end_net_margin),
    break_even_signup_rate: pct(scenario.break_even_purchase_rate),
    roas: `${Math.round(scenario.roas * 100) / 100}x`,
  });

  return {
    prospect: {
      name: lead.full_name?.trim() || lead.username,
      handle: lead.username,
      verified: lead.is_verified,
      private: lead.is_private,
    },
    audience: {
      followers: lead.followers ? compact(lead.followers) : null,
      following: lead.following ? compact(lead.following) : null,
      total_posts: lead.posts ? count(lead.posts) : null,
      engagement_rate: lead.engagement_rate ? pct(lead.engagement_rate, 2) : null,
      avg_likes: lead.avg_likes ? count(lead.avg_likes) : null,
      avg_comments: lead.avg_comments ? count(lead.avg_comments) : null,
      avg_views: lead.avg_views ? count(lead.avg_views) : null,
      posts_last_30_days: lead.posts_last_30_days !== null ? count(lead.posts_last_30_days) : null,
      reels_last_30_days: lead.reels_last_30_days !== null ? count(lead.reels_last_30_days) : null,
      cadence: lead.activity_status,
      measured_on: reportDate(lead.updated_at),
    },
    classification: {
      niche: lead.niche,
      business_model: lead.business_model,
      offer_type: lead.offer_type,
      audience_type: lead.audience_type,
    },
    offer: {
      reviewed: Boolean(lead.funnel_extracted_at),
      program_name: lead.funnel_program_name,
      summary: trim(lead.funnel_offer_summary, MAX_CAPTION),
      listed_price: lead.funnel_price,
      platform: lead.funnel_platform,
      url: lead.funnel_url ?? lead.external_link,
      observed_on: lead.funnel_extracted_at ? reportDate(lead.funnel_extracted_at) : null,
    },
    content: content
      ? {
          posts_analysed: content.postsAnalysed,
          median_engagement: count(content.medianEngagement),
          best_post_multiple_of_median: `${content.spikeRatio.toFixed(1)}x`,
          stronger_format: content.strongerFormat,
          reels_avg_engagement: count(content.reels.averageEngagement),
          static_avg_engagement: count(content.statics.averageEngagement),
        }
      : null,
    untrusted: {
      bio: trim(lead.bio, MAX_BIO),
      // Pinned posts are excluded for the same reason the content analysis
      // excludes them: pinning is a placement decision, not performance.
      recent_posts: (lead.recent_posts ?? [])
        .filter((post) => !post.is_pinned)
        .map((post) => ({
          caption: trim(post.caption, MAX_CAPTION),
          format: post.is_reel ? ("reel" as const) : ("static" as const),
          likes: post.likes,
          comments: post.comments,
          views: post.views,
          posted: post.taken_at ? reportDate(post.taken_at) : null,
        })),
    },
    economics: {
      projected: money(scenarios.projected),
      worst_case: money(scenarios.worst),
      inputs: args.assumptions.map((a) => ({
        input: a.label,
        value: a.display,
        basis: a.tier,
        source: a.source,
      })),
    },
    known_limits: args.limitations,
  };
}
