import "server-only";
import { hikerGet } from "./client";
import type { DiscoveredFollowing } from "@/lib/apify/actors";
import type { RecentPost, ScrapedProfile } from "@/lib/types";
import { ensureProfileFields } from "@/lib/pipeline/normalize";

// Pagination is API-driven via next_page_id (~25 users/page observed
// empirically in 2026-07-30 testing), not a client-side page size.

type HikerUser = {
  pk?: number | string;
  username?: string;
  full_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  is_business?: boolean;
  profile_pic_url?: string;
  biography?: string;
  external_url?: string;
  bio_links?: { url?: string }[];
  follower_count?: number;
  following_count?: number;
  media_count?: number;
  public_email?: string;
  public_phone_number?: string;
  category?: string;
};

// Resolve username -> full profile in one call. `/v1/user/by/username` returns
// pk + the same profile fields as /v2/user/by/id, so no separate lookup is
// needed just to get an id.
export async function fetchHikerProfileByUsername(opts: {
  apiKey: string;
  username: string;
}): Promise<HikerUser | null> {
  try {
    const user = await hikerGet<HikerUser>({
      apiKey: opts.apiKey,
      path: "/v1/user/by/username",
      params: { username: opts.username },
    });
    return user?.pk ? user : null;
  } catch {
    return null;
  }
}

// =============================================================================
// FOLLOWING list — used as a `following_scraper_provider` option
// (lib/pipeline/scrape-following.ts). Paginates /v2/user/following.
// =============================================================================
export async function scrapeFollowingViaHikerApi(opts: {
  apiKey: string;
  username: string;
  limit: number;
}): Promise<DiscoveredFollowing[]> {
  const seed = await fetchHikerProfileByUsername({ apiKey: opts.apiKey, username: opts.username });
  if (!seed?.pk) throw new Error(`HikerAPI could not resolve user_id for @${opts.username}`);

  const out: DiscoveredFollowing[] = [];
  let pageId: string | undefined;

  while (out.length < opts.limit) {
    const page = await hikerGet<{ response?: { users?: HikerUser[]; next_page_id?: string } }>({
      apiKey: opts.apiKey,
      path: "/v2/user/following",
      params: { user_id: seed.pk, page_id: pageId },
    });
    const users = page.response?.users ?? [];
    if (users.length === 0) break;

    for (const u of users) {
      if (!u.username) continue;
      out.push({
        username: u.username.toLowerCase(),
        full_name: u.full_name ?? null,
        is_private: !!u.is_private,
        is_verified: !!u.is_verified,
        profile_pic_url: u.profile_pic_url ?? null,
        ig_user_id: u.pk != null ? String(u.pk) : null,
      });
    }

    pageId = page.response?.next_page_id;
    if (!pageId) break;
  }

  return out.slice(0, opts.limit);
}

// =============================================================================
// PROFILE + recent posts — two calls: profile fields (confirmed working,
// tested 2026-07-30) + /gql/user/medias for engagement data.
//
// ⚠️ The /gql/user/medias field mapping below is UNVERIFIED — HikerAPI's
// account balance ran out during testing before a real call against this
// endpoint could be made. The shape assumed here mirrors Instagram's own
// GraphQL response (same as lib/scrapingbee/instagram.ts parses), since
// HikerAPI's /v1/user/by/username response was itself a near-verbatim proxy
// of Instagram's private API shape. Confirm against a real response and
// adjust field names before relying on avg_likes/avg_comments/engagement_rate
// computed from this in production — see lib/pipeline/metrics.ts.
// =============================================================================
type HikerMediaNode = {
  taken_at?: number;
  media_type?: number; // IG: 1=photo, 2=video, 8=carousel; reels typically product_type "clips"
  product_type?: string;
  like_count?: number;
  comment_count?: number;
  play_count?: number;
  view_count?: number;
  caption?: { text?: string } | string | null;
};

export async function scrapeProfileWithPostsViaHikerApi(opts: {
  apiKey: string;
  username: string;
}): Promise<ScrapedProfile | null> {
  const user = await fetchHikerProfileByUsername({ apiKey: opts.apiKey, username: opts.username });
  if (!user?.pk) return null;

  let recent_posts: RecentPost[] = [];
  try {
    const medias = await hikerGet<{ response?: { items?: HikerMediaNode[] } } | { items?: HikerMediaNode[] }>({
      apiKey: opts.apiKey,
      path: "/gql/user/medias",
      params: { user_id: user.pk },
    });
    const items =
      (medias as { response?: { items?: HikerMediaNode[] } }).response?.items ??
      (medias as { items?: HikerMediaNode[] }).items ??
      [];
    recent_posts = items.slice(0, 12).map((n) => ({
      caption: typeof n.caption === "string" ? n.caption : n.caption?.text ?? null,
      likes: n.like_count ?? null,
      comments: n.comment_count ?? null,
      views: n.play_count ?? n.view_count ?? null,
      taken_at: n.taken_at ? new Date(n.taken_at * 1000).toISOString() : null,
      is_reel: n.product_type === "clips" || n.media_type === 2,
    }));
  } catch {
    // Posts layer is best-effort — a profile with no/failed post data still
    // has real bio/follower fields worth keeping, so don't throw here.
    recent_posts = [];
  }

  return ensureProfileFields({
    username: user.username ?? opts.username,
    full_name: user.full_name ?? null,
    profile_pic_url: user.profile_pic_url ?? null,
    bio: user.biography ?? null,
    external_link: user.external_url ?? user.bio_links?.[0]?.url ?? null,
    followers: user.follower_count ?? 0,
    following: user.following_count ?? 0,
    posts: user.media_count ?? 0,
    is_private: !!user.is_private,
    is_verified: !!user.is_verified,
    recent_posts,
  });
}
