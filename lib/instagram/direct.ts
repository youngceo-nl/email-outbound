import "server-only";

// Free, direct-fetch profile metadata lookup against IG's own
// `web_profile_info` endpoint. Same endpoint our ScrapingBee path hits, just
// without the proxy middleman — so it's $0/profile but uses *your* IP and
// *your* burner-account cookie. Rate-limit / ban your own account if you go
// too fast. Throttling lives in the caller (backfill-metadata.ts), not here.

export class InstagramDirectError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = "InstagramDirectError";
  }
}

export type ProfileMetadata = {
  username: string;
  full_name: string | null;
  bio: string | null;
  external_link: string | null;
  followers: number;
  following: number;
  posts: number;
  is_private: boolean;
  is_verified: boolean;
};

type IgUser = {
  username?: string;
  full_name?: string;
  biography?: string;
  external_url?: string;
  is_private?: boolean;
  is_verified?: boolean;
  edge_followed_by?: { count?: number };
  edge_follow?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number };
};

export async function fetchProfileMetadataDirect(opts: {
  username: string;
  sessionCookie?: string | null;
  timeoutMs?: number;
}): Promise<ProfileMetadata | null> {
  const { username, sessionCookie, timeoutMs = 15_000 } = opts;
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "X-IG-App-ID": "936619743392459",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `https://www.instagram.com/${encodeURIComponent(username)}/`,
  };
  if (sessionCookie) headers["Cookie"] = sessionCookie;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(t);
    const msg = err instanceof Error ? err.message : String(err);
    throw new InstagramDirectError(`network error: ${msg}`, undefined, true);
  }
  clearTimeout(t);

  if (res.status === 404) return null;

  if (res.status === 429) {
    throw new InstagramDirectError(
      "Instagram rate-limited the request (HTTP 429). Slow down or wait.",
      429,
      true,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new InstagramDirectError(
      `Instagram rejected the session cookie (HTTP ${res.status}). Cookie may be expired or account flagged.`,
      res.status,
      false,
    );
  }

  const ctype = res.headers.get("content-type") ?? "";
  const body = await res.text();

  // IG returns HTML for login-walls and challenges, JSON for valid lookups.
  if (!ctype.includes("application/json")) {
    if (body.includes("login") || body.includes("challenge")) {
      throw new InstagramDirectError(
        "Instagram returned a login/challenge page — cookie required or banned.",
        res.status,
        false,
      );
    }
    throw new InstagramDirectError(
      `Unexpected non-JSON response (status ${res.status})`,
      res.status,
      false,
    );
  }

  let parsed: { data?: { user?: IgUser | null } };
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new InstagramDirectError(
      `Failed to parse JSON response: ${body.slice(0, 200)}`,
      res.status,
      false,
    );
  }

  const user = parsed?.data?.user;
  if (!user || !user.username) return null;

  return {
    username: user.username.toLowerCase(),
    full_name: user.full_name ?? null,
    bio: user.biography ?? null,
    external_link: user.external_url ?? null,
    followers: user.edge_followed_by?.count ?? 0,
    following: user.edge_follow?.count ?? 0,
    posts: user.edge_owner_to_timeline_media?.count ?? 0,
    is_private: !!user.is_private,
    is_verified: !!user.is_verified,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
