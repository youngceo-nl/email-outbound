import "server-only";
import { runActorSync, runActorAsync } from "./client";
import type { RecentPost, ScrapedProfile } from "@/lib/types";

const FOLLOWING_ACTOR = process.env.APIFY_FOLLOWING_ACTOR || "apify~instagram-follower-scraper";
const PROFILE_ACTOR   = process.env.APIFY_PROFILE_ACTOR   || "apify~instagram-profile-scraper";
const POSTS_ACTOR     = process.env.APIFY_POSTS_ACTOR     || "apify~instagram-post-scraper";

// Different community actors use different field names; normalize defensively.
type AnyRec = Record<string, unknown>;
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

// =============================================================================
// 1. Scrape FOLLOWING list of a username
// =============================================================================
// Default actor: scraping_solutions/instagram-scraper-followers-following-no-cookies
// Schema: { Account: string[], resultsLimit: int (100..500000), dataToScrape: "Followers"|"Followings" }
// Output rows: { username, username_scrape, type, full_name, id, is_private, is_verified, profile_pic_url }
export type DiscoveredFollowing = {
  username: string;
  full_name: string | null;
  is_private: boolean;
  is_verified: boolean;
  profile_pic_url: string | null;
  ig_user_id: string | null;
};

export async function scrapeFollowingDetailed(opts: {
  token: string;
  username: string;
  limit: number;
}): Promise<DiscoveredFollowing[]> {
  const resultsLimit = Math.max(100, Math.min(500000, opts.limit));
  const items = await runActorAsync<AnyRec>({
    token: opts.token,
    actorId: FOLLOWING_ACTOR,
    input: {
      Account: [opts.username],
      resultsLimit,
      dataToScrape: "Followings",
      usernames: [opts.username],
      maxResults: resultsLimit,
    },
    timeoutSecs: 600,
  });

  const byUsername = new Map<string, DiscoveredFollowing>();
  for (const it of items) {
    const user = (it.user as AnyRec | undefined) ?? undefined;
    const u =
      str(it.username) ??
      str(it.handle) ??
      str(user?.username) ??
      null;
    if (!u || u.toLowerCase() === opts.username.toLowerCase()) continue;
    const key = u.toLowerCase();
    if (byUsername.has(key)) continue;
    byUsername.set(key, {
      username: key,
      full_name: str(it.full_name) ?? str(it.fullName) ?? str(user?.full_name) ?? null,
      is_private: Boolean(it.is_private ?? it.isPrivate ?? user?.is_private ?? false),
      is_verified: Boolean(it.is_verified ?? it.isVerified ?? user?.is_verified ?? false),
      profile_pic_url: str(it.profile_pic_url) ?? str(it.profilePicUrl) ?? str(user?.profile_pic_url) ?? null,
      ig_user_id: str(it.id) ?? str(it.pk) ?? str(user?.id) ?? null,
    });
  }
  return [...byUsername.values()];
}

// Backwards-compat: just the usernames.
export async function scrapeFollowing(opts: {
  token: string;
  username: string;
  limit: number;
}): Promise<string[]> {
  const items = await scrapeFollowingDetailed(opts);
  return items.map((i) => i.username);
}

// =============================================================================
// 2. Scrape PROFILE metadata for a batch of usernames
// =============================================================================
export async function scrapeProfiles(opts: {
  token: string;
  usernames: string[];
}): Promise<ScrapedProfile[]> {
  if (opts.usernames.length === 0) return [];
  // Use async run+poll: the sync endpoint caps at 300s and returns 201 (not items)
  // for batches that take longer, causing .map() to fail on the run metadata object.
  const items = await runActorAsync<AnyRec>({
    token: opts.token,
    actorId: PROFILE_ACTOR,
    input: {
      usernames: opts.usernames,
      directUrls: opts.usernames.map((u) => `https://www.instagram.com/${u}/`),
      resultsType: "details",
      resultsLimit: opts.usernames.length,
    },
    timeoutSecs: 600,
  });

  return items
    .map((it): ScrapedProfile | null => {
      const username = (str(it.username) ?? str(it.ownerUsername) ?? "").toLowerCase();
      if (!username) return null;
      return {
        username,
        full_name: str(it.fullName) ?? str(it.full_name) ?? null,
        profile_url: str(it.url) ?? `https://www.instagram.com/${username}/`,
        bio: str(it.biography) ?? str(it.bio) ?? null,
        external_link: str(it.externalUrl) ?? str(it.external_url) ?? null,
        followers: num(it.followersCount) ?? num(it.followers) ?? 0,
        following: num(it.followsCount) ?? num(it.following) ?? 0,
        posts: num(it.postsCount) ?? num(it.posts) ?? 0,
        is_private: Boolean(it.private ?? it.isPrivate ?? false),
        is_verified: Boolean(it.verified ?? it.isVerified ?? false),
        recent_posts: [],
      };
    })
    .filter((p): p is ScrapedProfile => p !== null);
}

// =============================================================================
// 3. Scrape RECENT POSTS for a batch of usernames → grouped by username
// =============================================================================
export async function scrapePosts(opts: {
  token: string;
  usernames: string[];
  limit: number;     // posts per user (6–12)
}): Promise<Map<string, RecentPost[]>> {
  const out = new Map<string, RecentPost[]>();
  if (opts.usernames.length === 0) return out;

  const items = await runActorAsync<AnyRec>({
    token: opts.token,
    actorId: POSTS_ACTOR,
    input: {
      username: opts.usernames,
      directUrls: opts.usernames.map((u) => `https://www.instagram.com/${u}/`),
      resultsType: "posts",
      resultsLimit: opts.limit,
      onlyPostsNewerThan: "30 days",
    },
    timeoutSecs: 600,
  });

  for (const it of items) {
    const owner = (str(it.ownerUsername) ?? str(it.username) ?? "").toLowerCase();
    if (!owner) continue;
    const post: RecentPost = {
      caption: str(it.caption) ?? null,
      likes: num(it.likesCount) ?? num(it.likes),
      comments: num(it.commentsCount) ?? num(it.comments),
      views: num(it.videoViewCount) ?? num(it.videoPlayCount) ?? num(it.views),
      taken_at: str(it.timestamp) ?? str(it.takenAt) ?? null,
    };
    const arr = out.get(owner) ?? [];
    arr.push(post);
    out.set(owner, arr);
  }

  // Trim to limit per user
  for (const [u, arr] of out) {
    out.set(
      u,
      arr
        .sort((a, b) => (b.taken_at ?? "").localeCompare(a.taken_at ?? ""))
        .slice(0, opts.limit),
    );
  }
  return out;
}
