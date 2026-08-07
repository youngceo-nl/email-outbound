import "server-only";
import { runActorSync, runActorAsync, runActorAsyncWithOutput } from "./client";
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

/*
 * The configured actor (scraping_solutions/instagram-scraper-followers-
 * following-no-cookies) delivers at most ~1000 results per run and reports
 * the rest via a `continuationToken` in its OUTPUT record rather than by
 * accepting a larger `resultsLimit` in one call — confirmed directly against
 * a real run (OUTPUT: `"hasNextPage": true, "nextContinuationToken": "..."`)
 * after a crawl against a 3,116-following account silently returned only the
 * first 1,000 and reported it as complete. `resultsLimit`/`maxResults` still
 * matter (they cap the total across all pages, per the actor's own schema:
 * "50-20000 are the allowed values"), but reaching that total takes multiple
 * runs, not one. MAX_PAGES bounds the worst case (a token/plan wedge before
 * runaway spend) rather than trusting hasNextPage never to loop.
 */
const MAX_CONTINUATION_PAGES = 10;

export async function scrapeFollowingDetailed(opts: {
  token: string | string[];
  username: string;
  limit: number;
  /** Resume a previous extraction instead of restarting it — see scrapeFollowingPaged. */
  startContinuationToken?: string | null;
}): Promise<DiscoveredFollowing[]> {
  return (await scrapeFollowingPaged(opts)).items;
}

/**
 * As scrapeFollowingDetailed, but also returns the actor's leftover
 * continuation token so a caller can resume later.
 *
 * This matters because the actor's free tier delivers ~1,000 results per
 * account per day. Without persisting the cursor, the next day's run restarts
 * from the top and spends its entire allowance re-delivering accounts we
 * already have — the quota is charged on what the actor DELIVERS, so
 * de-duplicating on our side recovers nothing. The token is valid for about a
 * week (`expiresAtUtc` in the actor's OUTPUT).
 */
export async function scrapeFollowingPaged(opts: {
  token: string | string[];
  username: string;
  limit: number;
  startContinuationToken?: string | null;
}): Promise<{ items: DiscoveredFollowing[]; nextContinuationToken: string | null }> {
  const resultsLimit = Math.max(100, Math.min(500000, opts.limit));
  const items: AnyRec[] = [];
  let continuationToken: string | undefined = opts.startContinuationToken ?? undefined;
  let leftoverToken: string | null = null;

  for (let page = 0; page < MAX_CONTINUATION_PAGES; page++) {
    const input: AnyRec = {
      Account: [opts.username],
      resultsLimit,
      dataToScrape: "Followings",
      usernames: [opts.username],
      maxResults: resultsLimit,
    };
    if (continuationToken) input.continuationToken = continuationToken;

    const { items: pageItems, output } = await runActorAsyncWithOutput<AnyRec>({
      token: opts.token,
      actorId: FOLLOWING_ACTOR,
      input,
      timeoutSecs: 600,
      // A free-tier token that's used its daily allowance gets a 200 OK with
      // 0 items and this shape in OUTPUT, not an HTTP 403 — treating it as
      // exhausted rotates to the next token in `opts.token` automatically,
      // same as a real rate-limit response.
      isOutputExhausted: (o) => {
        const rec = o as AnyRec | null;
        return rec?.success === false && typeof rec?.status === "string" && rec.status.includes("LIMIT");
      },
    });
    items.push(...pageItems);
    if (items.length >= resultsLimit) break;

    const continuation = (output as AnyRec | null)?.continuations as AnyRec[] | undefined;
    const next = continuation?.[0];
    if (!next?.hasNextPage || typeof next.nextContinuationToken !== "string") {
      leftoverToken = null;
      break;
    }
    continuationToken = next.nextContinuationToken;
    leftoverToken = next.nextContinuationToken;
  }

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
  return { items: [...byUsername.values()], nextContinuationToken: leftoverToken };
}

// Backwards-compat: just the usernames.
export async function scrapeFollowing(opts: {
  token: string | string[];
  username: string;
  limit: number;
}): Promise<string[]> {
  const items = await scrapeFollowingDetailed(opts);
  return items.map((i) => i.username);
}

// =============================================================================
// 2. Scrape PROFILE metadata for a batch of usernames
// =============================================================================
/**
 * Posts embedded in a profile-actor result. Same field names the standalone
 * posts actor uses, so both paths produce identical RecentPost shapes.
 *
 * Note these are the *latest* posts, not a 30-day window — an account that
 * last posted years ago still returns 12 here. Recency has to be judged from
 * `taken_at`, not from the list being non-empty.
 */
function mapLatestPosts(raw: unknown): RecentPost[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is AnyRec => !!p && typeof p === "object")
    .map((p) => ({
      caption: str(p.caption) ?? null,
      likes: num(p.likesCount) ?? num(p.likes),
      comments: num(p.commentsCount) ?? num(p.comments),
      views: num(p.videoViewCount) ?? num(p.videoPlayCount) ?? num(p.views),
      taken_at: str(p.timestamp) ?? str(p.takenAt) ?? null,
      // Reels are the activity signal (see computeMetrics / metricsGate).
      // Apify marks them productType "clips"; the Video fallback covers actors
      // that omit productType. Without these two flags reels_last_30_days is
      // always 0 and the whole reels gate sits inert.
      is_reel: str(p.productType) === "clips" || str(p.type) === "Video",
      is_pinned: Boolean(p.isPinned ?? p.is_pinned ?? false),
    }));
}

export async function scrapeProfiles(opts: {
  token: string | string[];
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
        profile_pic_url: str(it.profilePicUrlHD) ?? str(it.profilePicUrl) ?? str(it.profile_pic_url) ?? null,
        bio: str(it.biography) ?? str(it.bio) ?? null,
        external_link: str(it.externalUrl) ?? str(it.external_url) ?? null,
        followers: num(it.followersCount) ?? num(it.followers) ?? 0,
        following: num(it.followsCount) ?? num(it.following) ?? 0,
        posts: num(it.postsCount) ?? num(it.posts) ?? 0,
        is_private: Boolean(it.private ?? it.isPrivate ?? false),
        is_verified: Boolean(it.verified ?? it.isVerified ?? false),
        // The profile actor already returns the last ~12 posts inline. This
        // used to be hardcoded to [], which threw them away and then failed
        // hardFilter's non-empty recent_posts check — every Apify-backfilled
        // profile was rejected as "no_recent_posts" while a second actor run
        // was needed to recover data we'd already been given.
        recent_posts: mapLatestPosts(it.latestPosts),
      };
    })
    .filter((p): p is ScrapedProfile => p !== null);
}

// =============================================================================
// 3. Scrape RECENT POSTS for a batch of usernames → grouped by username
// =============================================================================
export async function scrapePosts(opts: {
  token: string | string[];
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
      // Kept in step with mapLatestPosts so this path can't silently produce
      // reel-less posts if it is ever wired back in.
      is_reel: str(it.productType) === "clips" || str(it.type) === "Video",
      is_pinned: Boolean(it.isPinned ?? it.is_pinned ?? false),
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
