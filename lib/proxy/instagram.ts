import "server-only";
import { proxyFetch, ProxyFetchError, type ProxyCreds } from "./client";
import { getNextCookie } from "./cookie-pool";
import type { RecentPost, ScrapedProfile } from "@/lib/types";

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

function formatCookie(cookie: string | null | undefined): string | null {
  if (!cookie) return null;
  const t = cookie.trim();
  if (t && !t.includes("=") && !t.includes(";")) return `sessionid=${t}`;
  return t;
}

export async function scrapeProfileViaProxy(opts: {
  username: string;
  sessionCookie?: string | null;
  cookiePool?: string | null;
  proxyCreds?: ProxyCreds | null;
}): Promise<ScrapedProfile | null> {
  const cookie = formatCookie(opts.sessionCookie) ?? formatCookie(getNextCookie(opts.cookiePool));
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://www.instagram.com/${opts.username}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
  if (cookie) headers["Cookie"] = cookie;

  const { body } = await proxyFetch(url, headers, { creds: opts.proxyCreds });

  let json: { data?: { user?: IgUser } };
  try { json = JSON.parse(body); }
  catch { throw new ProxyFetchError(`non-JSON from web_profile_info @${opts.username}: ${body.slice(0, 200)}`); }

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

async function resolveUserId(opts: {
  username: string;
  sessionCookie: string;
  proxyCreds?: ProxyCreds | null;
}): Promise<string | null> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Referer": `https://www.instagram.com/${opts.username}/`,
    "Cookie": opts.sessionCookie,
  };
  const { body } = await proxyFetch(url, headers, { creds: opts.proxyCreds });
  try {
    const json = JSON.parse(body);
    const id = json?.data?.user?.id ?? json?.user?.id ?? null;
    if (id) return String(id);
  } catch { /* fall through */ }
  const m = body.match(/"profilePage_(\d+)"/) || body.match(/"owner":\{"id":"(\d+)"/) || body.match(/"user_id":"(\d+)"/);
  return m ? m[1] : null;
}

export async function scrapeFollowingViaProxy(opts: {
  username: string;
  limit: number;
  sessionCookie?: string | null;
  cookiePool?: string | null;
  proxyCreds?: ProxyCreds | null;
}): Promise<string[]> {
  const cookie = formatCookie(opts.sessionCookie) ?? formatCookie(getNextCookie(opts.cookiePool));
  if (!cookie) throw new ProxyFetchError("No IG session cookie available for proxy following scrape. Set instagram_session_cookie or instagram_cookies in Settings.");

  const userId = await resolveUserId({ username: opts.username, sessionCookie: cookie, proxyCreds: opts.proxyCreds });
  if (!userId) throw new ProxyFetchError(`Could not resolve user_id for @${opts.username}`);

  const out = new Set<string>();
  let maxId: string | null = null;
  const pageSize = 50;
  const headers: Record<string, string> = {
    "User-Agent": "Instagram 291.0.0.29.111 Android (30/11; 480dpi; 1080x2137; samsung; SM-G973F; beyond1; exynos9820; en_US; 493494379)",
    "X-IG-App-ID": "936619743392459",
    "Accept": "*/*",
    "Accept-Language": "en-US",
    "Referer": `https://www.instagram.com/${opts.username}/`,
    "Cookie": cookie,
  };

  while (out.size < opts.limit) {
    const u = new URL(`https://www.instagram.com/api/v1/friendships/${userId}/following/`);
    u.searchParams.set("count", String(pageSize));
    if (maxId) u.searchParams.set("max_id", maxId);

    const { body } = await proxyFetch(u.toString(), headers, { creds: opts.proxyCreds });
    let json: { users?: { username?: string }[]; next_max_id?: string };
    try { json = JSON.parse(body); }
    catch { throw new ProxyFetchError(`non-JSON for following list of @${opts.username}: ${body.slice(0, 300)}`); }

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
