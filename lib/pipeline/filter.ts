import type { AppSettings, ScrapedProfile } from "@/lib/types";

export type FilterResult = { ok: true } | { ok: false; reason: string };

// Hard filter — runs BEFORE Claude. Cheap rejections to save API spend.
export function hardFilter(profile: ScrapedProfile, settings: AppSettings): FilterResult {
  if (profile.is_private) return { ok: false, reason: "private_account" };

  if (profile.followers < settings.min_followers) {
    return { ok: false, reason: `followers_below_min (${profile.followers} < ${settings.min_followers})` };
  }
  if (profile.followers > settings.max_followers) {
    return { ok: false, reason: `followers_above_max (${profile.followers} > ${settings.max_followers})` };
  }

  if (!profile.bio || profile.bio.trim().length < 5) {
    return { ok: false, reason: "no_bio" };
  }

  if (!profile.recent_posts || profile.recent_posts.length === 0) {
    return { ok: false, reason: "no_recent_posts" };
  }

  // Keyword filters
  const haystack = `${profile.bio} ${profile.full_name ?? ""} ${profile.username}`.toLowerCase();
  if (settings.exclude_keywords?.length) {
    const hit = settings.exclude_keywords.find((kw) => kw && haystack.includes(kw.toLowerCase()));
    if (hit) return { ok: false, reason: `excluded_keyword:${hit}` };
  }
  if (settings.include_keywords?.length) {
    const hit = settings.include_keywords.some((kw) => kw && haystack.includes(kw.toLowerCase()));
    if (!hit) return { ok: false, reason: "no_include_keyword_match" };
  }

  // Obvious junk heuristics
  const junkBio = /\b(meme|fan ?page|memes|news|gossip|paparazzi)\b/i;
  if (profile.bio && junkBio.test(profile.bio)) {
    return { ok: false, reason: "junk_keyword_in_bio" };
  }

  return { ok: true };
}

// Post-metric gate — applied after metrics computed, still pre-Claude.
export function metricsGate(
  metrics: { engagement_rate: number | null; posts_last_30_days: number },
  settings: AppSettings,
): FilterResult {
  if ((metrics.engagement_rate ?? 0) < settings.min_engagement_rate) {
    return {
      ok: false,
      reason: `engagement_below_min (${metrics.engagement_rate ?? 0} < ${settings.min_engagement_rate})`,
    };
  }
  if (metrics.posts_last_30_days < settings.min_posts_last_30_days) {
    return {
      ok: false,
      reason: `posts_30d_below_min (${metrics.posts_last_30_days} < ${settings.min_posts_last_30_days})`,
    };
  }
  return { ok: true };
}
