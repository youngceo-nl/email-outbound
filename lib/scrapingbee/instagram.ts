import "server-only";
import { scrapingBeeGet, ScrapingBeeError } from "./client";
import type { RecentPost, ScrapedProfile } from "@/lib/types";

// =============================================================================
// Profile + recent posts in ONE call via IG's web_profile_info endpoint.
// This endpoint works without auth for public profiles (rate-limited; SB rotates IPs).
// Returns the canonical ScrapedProfile shape with up to 12 recent posts populated.
// =============================================================================
type IgPostNode = {
  shortcode?: string;
  is_video?: boolean;
  video_view_count?: number;
  edge_liked_by?: { count?: number };
  edge_media_preview_like?: { count?: number };
  edge_media_to_comment?: { count?: number };
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  taken_at_timestamp?: number;
};

type IgUser = {
  id?: string;
  username?: string;
  full_name?: string;
  biography?: string;
  external_url?: string;
  is_verified?: boolean;
  is_private?: boolean;
  edge_followed_by?: { count?: number };
  edge_follow?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number; edges?: { node?: IgPostNode }[] };
};

export async function scrapeProfileWithPostsViaScrapingBee(opts: {
  apiKey: string;
  username: string;
  sessionCookie?: string | null;
}): Promise<ScrapedProfile | null> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; LeadsScraper/1.0)",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
  };
  if (opts.sessionCookie) headers["Cookie"] = opts.sessionCookie;

  const { body } = await scrapingBeeGet({
    apiKey: opts.apiKey,
    url,
    premiumProxy: true,
    forwardHeaders: headers,
  });

  let json: { data?: { user?: IgUser } };
  try {
    json = JSON.parse(body);
  } catch {
    throw new ScrapingBeeError(`SB returned non-JSON for web_profile_info @${opts.username}: ${body.slice(0, 200)}`);
  }

  const user = json?.data?.user;
  if (!user || !user.username) return null;

  const recent_posts: RecentPost[] = (user.edge_owner_to_timeline_media?.edges ?? [])
    .map((e) => e.node)
    .filter((n): n is IgPostNode => !!n)
    .map((n) => ({
      caption: n.edge_media_to_caption?.edges?.[0]?.node?.text ?? null,
      likes: n.edge_liked_by?.count ?? n.edge_media_preview_like?.count ?? null,
      comments: n.edge_media_to_comment?.count ?? null,
      views: n.is_video ? n.video_view_count ?? null : null,
      taken_at: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : null,
    }));

  return {
    username: user.username.toLowerCase(),
    full_name: user.full_name ?? null,
    profile_url: `https://www.instagram.com/${user.username}/`,
    bio: user.biography ?? null,
    external_link: user.external_url ?? null,
    followers: user.edge_followed_by?.count ?? 0,
    following: user.edge_follow?.count ?? 0,
    posts: user.edge_owner_to_timeline_media?.count ?? 0,
    is_private: !!user.is_private,
    is_verified: !!user.is_verified,
    recent_posts,
  };
}

// Resolve a username -> numeric IG user_id by hitting web_profile_info.
// The older ?__a=1 endpoint was deprecated — IG now returns a login wall HTML.
export async function resolveUserId(opts: {
  apiKey: string;
  username: string;
  sessionCookie?: string | null;
}): Promise<string | null> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Referer": `https://www.instagram.com/${opts.username}/`,
  };
  if (opts.sessionCookie) headers["Cookie"] = opts.sessionCookie;

  const { body } = await scrapingBeeGet({
    apiKey: opts.apiKey,
    url,
    premiumProxy: true,
    forwardHeaders: headers,
  });

  try {
    const json = JSON.parse(body);
    const id = json?.data?.user?.id ?? json?.user?.id ?? null;
    if (id) return String(id);
  } catch {
    /* fall through to HTML-scrape fallback */
  }
  // Last-resort HTML scrape (rare path)
  const m = body.match(/"profilePage_(\d+)"/) || body.match(/"owner":\{"id":"(\d+)"/) || body.match(/"user_id":"(\d+)"/);
  if (m) return m[1];

  throw new ScrapingBeeError(
    `Could not resolve user_id for @${opts.username}. First 300 chars of response: ${body.slice(0, 300)}`,
  );
}

// Scrape the FOLLOWING list of a user via IG's v1 friendships endpoint.
// Requires a logged-in IG sessionid cookie; IG does not allow anonymous access.
//
// Uses the i.instagram.com mobile-API endpoint which is more stable than
// the public GraphQL `query_hash` (IG rotates those constantly).
export async function scrapeFollowingViaScrapingBee(opts: {
  apiKey: string;
  username: string;
  limit: number;
  sessionCookie?: string | null;
}): Promise<string[]> {
  if (!opts.sessionCookie) {
    throw new ScrapingBeeError(
      "ScrapingBee following scrape requires `instagram_session_cookie` to be set in Settings " +
        "(IG does not expose following lists anonymously).",
    );
  }

  const userId = await resolveUserId({
    apiKey: opts.apiKey,
    username: opts.username,
    sessionCookie: opts.sessionCookie,
  });
  if (!userId) throw new ScrapingBeeError(`Could not resolve user_id for @${opts.username}`);

  const out = new Set<string>();
  let maxId: string | null = null;
  const pageSize = 50;
  const headers: Record<string, string> = {
    "User-Agent": "Instagram 291.0.0.29.111 Android (30/11; 480dpi; 1080x2137; samsung; SM-G973F; beyond1; exynos9820; en_US; 493494379)",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "en-US",
    "Referer": `https://www.instagram.com/${opts.username}/`,
    "Cookie": opts.sessionCookie,
  };

  while (out.size < opts.limit) {
    const u = new URL(`https://www.instagram.com/api/v1/friendships/${userId}/following/`);
    u.searchParams.set("count", String(pageSize));
    if (maxId) u.searchParams.set("max_id", maxId);

    const { body } = await scrapingBeeGet({
      apiKey: opts.apiKey,
      url: u.toString(),
      premiumProxy: true,
      forwardHeaders: headers,
    });

    let json: { users?: { username?: string }[]; next_max_id?: string; big_list?: boolean };
    try {
      json = JSON.parse(body);
    } catch {
      throw new ScrapingBeeError(
        `SB returned non-JSON for following list of @${opts.username}. First 300 chars: ${body.slice(0, 300)}`,
      );
    }

    const users = json.users ?? [];
    if (users.length === 0) break;
    for (const row of users) {
      const name = row.username?.toLowerCase();
      if (name && name !== opts.username.toLowerCase()) out.add(name);
    }

    if (!json.next_max_id) break;
    maxId = json.next_max_id;
  }

  return [...out].slice(0, opts.limit);
}
