/*
 * Instagram evidence normalization.
 *
 * Every optional surface carries its own capture state. The normalizer never
 * emits `captured` for a surface the provider did not return — an absent field
 * becomes `unavailable`, and a surface we never asked for becomes
 * `not_attempted`. Downstream code is then free to treat `captured` + empty as
 * genuine absence without ever confusing it with a scrape failure.
 */

import type {
  AcquisitionSource,
  ActivityMetrics,
  CaptureStatus,
  DataQuality,
  InstagramEvidence,
  InstagramPostEvidence,
  InstagramProfileExtractionMethod,
} from "@/lib/qualification/types";
import { scrapingBeeGet } from "./http";
import { fetchInstagramEvidenceViaApify } from "./apify";

// ---------------------------------------------------------------------------
// Provider payloads
// ---------------------------------------------------------------------------

type RawPostNode = {
  id?: string;
  shortcode?: string;
  is_video?: boolean;
  video_view_count?: number;
  edge_liked_by?: { count?: number };
  edge_media_preview_like?: { count?: number };
  edge_media_to_comment?: { count?: number };
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> };
  taken_at_timestamp?: number;
  pinned_for_users?: unknown[];
};

export type RawInstagramUser = {
  id?: string;
  username?: string;
  full_name?: string;
  biography?: string;
  external_url?: string;
  category_name?: string | null;
  business_category_name?: string | null;
  is_verified?: boolean;
  is_private?: boolean;
  highlight_reel_count?: number;
  edge_followed_by?: { count?: number };
  edge_follow?: { count?: number };
  edge_owner_to_timeline_media?: { count?: number; edges?: Array<{ node?: RawPostNode }> };
};

export type InstagramAcquisitionInput = {
  username: string;
  user: RawInstagramUser | null;
  /** Set when the provider call failed outright, as opposed to returning nothing. */
  providerError?: string | null;
  metaDescription?: string | null;
  extractionMethod?: InstagramProfileExtractionMethod;
  /*
   * Which acquisition path actually served this profile. `extractionMethod`
   * cannot answer that — Apify and the ScrapingBee endpoint both report
   * "provider" — and "which provider served this lead" is the first question
   * asked when a run looks wrong.
   */
  acquisitionSource?: AcquisitionSource;
  /** Highlight scraping is a separate authenticated surface; v1 does not attempt it. */
  highlightTitles?: string[] | null;
  highlightsCaptureStatus?: CaptureStatus;
  capturedAt?: string;
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalizeInstagramEvidence(input: InstagramAcquisitionInput): InstagramEvidence {
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const user = input.user;

  if (!user || !user.username) {
    // No profile means every downstream surface is unknown, not empty.
    return {
      username: input.username.toLowerCase(),
      display_name: null,
      category: null,
      bio: null,
      external_link: null,
      is_private: false,
      is_verified: false,
      followers: null,
      following: null,
      total_posts: null,
      instagram_meta_description: input.metaDescription ?? null,
      profile_extraction_method: input.extractionMethod ?? "provider",
      acquisition_source: input.acquisitionSource,
      profile_capture_status: input.providerError ? "failed" : "unavailable",
      profile_captured_at: null,
      external_link_capture_status: "not_attempted",
      recent_posts: [],
      recent_posts_capture_status: "not_attempted",
      pinned_posts: [],
      pinned_posts_capture_status: "not_attempted",
      story_highlight_titles: [],
      story_highlights_capture_status: input.highlightsCaptureStatus ?? "not_attempted",
      story_highlights_captured_at: null,
    };
  }

  const edges = user.edge_owner_to_timeline_media?.edges;
  const postsReturned = Array.isArray(edges);
  const allPosts: InstagramPostEvidence[] = (edges ?? [])
    .map((edge) => edge?.node)
    .filter((node): node is RawPostNode => Boolean(node))
    .map(normalizePost);

  const pinned = allPosts.filter((post) => post.is_pinned);
  const totalPosts = user.edge_owner_to_timeline_media?.count ?? null;

  /*
   * A private account legitimately returns no posts. A public account that
   * claims posts but returned none is a scrape failure, and calling that
   * `captured` would let "no recent posts" masquerade as evidence of absence.
   */
  const recentPostsStatus: CaptureStatus = !postsReturned
    ? "unavailable"
    : allPosts.length === 0 && !user.is_private && (totalPosts ?? 0) > 0
      ? "failed"
      : "captured";

  /*
   * `pinned_for_users` is present on the node only in some provider responses.
   * When no post carries the marker at all we cannot distinguish "no pinned
   * posts" from "this provider does not report pinning".
   */
  const pinnedMarkerSeen = (edges ?? []).some(
    (edge) => edge?.node && "pinned_for_users" in edge.node,
  );
  const pinnedStatus: CaptureStatus =
    recentPostsStatus !== "captured" ? "unavailable" : pinnedMarkerSeen ? "captured" : "unavailable";

  const highlightTitles = input.highlightTitles ?? null;
  const highlightsStatus: CaptureStatus =
    input.highlightsCaptureStatus ?? (highlightTitles ? "captured" : "not_attempted");

  return {
    username: user.username.toLowerCase(),
    display_name: emptyToNull(user.full_name),
    category: emptyToNull(user.category_name ?? user.business_category_name ?? null),
    bio: emptyToNull(user.biography),
    external_link: emptyToNull(user.external_url),
    is_private: Boolean(user.is_private),
    is_verified: Boolean(user.is_verified),
    followers: user.edge_followed_by?.count ?? null,
    following: user.edge_follow?.count ?? null,
    total_posts: totalPosts,
    instagram_meta_description: input.metaDescription ?? null,
    profile_extraction_method: input.extractionMethod ?? "provider",
    acquisition_source: input.acquisitionSource,
    profile_capture_status: "captured",
    profile_captured_at: capturedAt,
    // The metadata fallback parses the public profile page, which does not
    // expose the bio link at all — that surface stays unknown.
    external_link_capture_status:
      (input.extractionMethod ?? "provider") === "metadata_fallback" ? "unavailable" : "captured",
    recent_posts: allPosts.filter((post) => !post.is_pinned).slice(0, 18),
    recent_posts_capture_status: recentPostsStatus,
    pinned_posts: pinned,
    pinned_posts_capture_status: pinnedStatus,
    story_highlight_titles: highlightTitles ?? [],
    story_highlights_capture_status: highlightsStatus,
    story_highlights_captured_at: highlightsStatus === "captured" ? capturedAt : null,
  };
}

function normalizePost(node: RawPostNode): InstagramPostEvidence {
  return {
    post_id: node.shortcode ?? node.id ?? "unknown",
    caption: emptyToNull(node.edge_media_to_caption?.edges?.[0]?.node?.text),
    taken_at: node.taken_at_timestamp
      ? new Date(node.taken_at_timestamp * 1000).toISOString()
      : null,
    is_video: Boolean(node.is_video),
    is_pinned: Array.isArray(node.pinned_for_users) && node.pinned_for_users.length > 0,
    likes: node.edge_liked_by?.count ?? node.edge_media_preview_like?.count ?? null,
    comments: node.edge_media_to_comment?.count ?? null,
    views: node.is_video ? (node.video_view_count ?? null) : null,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Activity metrics — priority input only, never an eligibility input
// ---------------------------------------------------------------------------

export function computeActivityMetrics(
  evidence: InstagramEvidence,
  dataQuality: DataQuality,
  now = Date.now(),
): ActivityMetrics {
  const posts = evidence.recent_posts;
  const captured = evidence.recent_posts_capture_status === "captured";

  if (!captured || posts.length === 0) {
    return {
      data_quality: dataQuality,
      median_unpinned_reel_views: null,
      reel_view_rate: null,
      posts_last_30_days: null,
      reels_last_30_days: null,
      days_since_latest_post: null,
      median_likes_per_follower: null,
    };
  }

  const reelViews = posts
    .filter((post) => post.is_video && typeof post.views === "number" && post.views > 0)
    .map((post) => post.views as number);

  // Below three samples a "median" is one lucky post, so reach stays unknown.
  const medianViews = reelViews.length >= 3 ? median(reelViews) : null;
  const followers = evidence.followers ?? 0;

  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const dated = posts.filter((post) => post.taken_at);
  const inWindow = dated.filter((post) => new Date(post.taken_at as string).getTime() > cutoff);
  const latest = dated
    .map((post) => new Date(post.taken_at as string).getTime())
    .sort((a, b) => b - a)[0];

  const likes = posts
    .filter((post) => typeof post.likes === "number")
    .map((post) => post.likes as number);

  return {
    data_quality: dataQuality,
    median_unpinned_reel_views: medianViews,
    reel_view_rate: medianViews !== null && followers > 0 ? medianViews / followers : null,
    posts_last_30_days: dated.length > 0 ? inWindow.length : null,
    reels_last_30_days: dated.length > 0 ? inWindow.filter((p) => p.is_video).length : null,
    days_since_latest_post:
      latest !== undefined ? Math.floor((now - latest) / (24 * 60 * 60 * 1000)) : null,
    median_likes_per_follower:
      likes.length > 0 && followers > 0 ? median(likes) / followers : null,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

const IG_APP_ID = "936619743392459";

/** Reads the public web_profile_info endpoint through ScrapingBee's proxy pool. */
export async function fetchInstagramEvidence(opts: {
  apiKey: string;
  username: string;
  sessionCookie?: string | null;
}): Promise<InstagramAcquisitionInput> {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(opts.username)}`;
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (compatible; LeadsScraper/1.0)",
    "X-IG-App-ID": IG_APP_ID,
    Accept: "*/*",
  };
  if (opts.sessionCookie) headers.Cookie = opts.sessionCookie;

  try {
    const { body } = await scrapingBeeGet({
      apiKey: opts.apiKey,
      url,
      premiumProxy: true,
      forwardHeaders: headers,
      /*
       * One retry, not three. This endpoint returns a hard 500 for a meaningful
       * share of accounts, and we have a working metadata fallback — spending
       * three 45s attempts before reaching it just makes acquisition slow and
       * occasionally times the whole lead out.
       */
      retries: 1,
    });
    const parsed = JSON.parse(body) as { data?: { user?: RawInstagramUser } };
    const user = parsed?.data?.user ?? null;
    return {
      username: opts.username,
      user: user && user.username ? user : null,
      providerError: user ? null : "profile_not_returned",
      extractionMethod: "provider",
      acquisitionSource: "scrapingbee_web_profile_info",
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      username: opts.username,
      user: null,
      providerError: err instanceof Error ? err.message : String(err),
      extractionMethod: "provider",
      acquisitionSource: "scrapingbee_web_profile_info",
      capturedAt: new Date().toISOString(),
    };
  }
}

/*
 * Fallback acquisition: the public profile page.
 *
 * The web_profile_info endpoint returns a hard 500 for some accounts while the
 * ordinary profile page still renders. That page embeds the biography and
 * display name in JSON and reports follower/following/post counts in its
 * og:description, which is enough for a bio-only commercial score. It does NOT
 * expose the external link, so that surface is recorded as unavailable rather
 * than absent.
 */
export async function fetchInstagramEvidenceViaMetadata(opts: {
  apiKey: string;
  username: string;
}): Promise<InstagramAcquisitionInput> {
  try {
    const { body } = await scrapingBeeGet({
      apiKey: opts.apiKey,
      url: `https://www.instagram.com/${encodeURIComponent(opts.username)}/`,
      premiumProxy: true,
    });

    const biography = extractJsonString(body, "biography");
    const fullName = extractJsonString(body, "full_name");
    const metaDescription = decodeEntities(
      body.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? "",
    );

    if (!biography && !metaDescription) {
      return {
        username: opts.username,
        user: null,
        providerError: "metadata fallback found no bio or description",
        extractionMethod: "metadata_fallback",
        acquisitionSource: "scrapingbee_metadata",
        capturedAt: new Date().toISOString(),
      };
    }

    const counts = metaDescription.match(
      /([\d.,]+[KMB]?)\s+Followers,\s+([\d.,]+[KMB]?)\s+Following,\s+([\d.,]+[KMB]?)\s+Posts/i,
    );

    return {
      username: opts.username,
      user: {
        username: opts.username,
        full_name: fullName ?? undefined,
        biography: biography ?? undefined,
        is_private: /"is_private":true/.test(body),
        is_verified: /"is_verified":true/.test(body),
        edge_followed_by: counts ? { count: parseCompact(counts[1]) } : undefined,
        edge_follow: counts ? { count: parseCompact(counts[2]) } : undefined,
        // Posts exist but were not returned by this surface. Reporting the count
        // without the sample is what lets sufficiency mark the sample unknown
        // instead of treating the account as inactive.
        edge_owner_to_timeline_media: counts ? { count: parseCompact(counts[3]) } : undefined,
      },
      metaDescription,
      extractionMethod: "metadata_fallback",
      acquisitionSource: "scrapingbee_metadata",
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      username: opts.username,
      user: null,
      providerError: err instanceof Error ? err.message : String(err),
      extractionMethod: "metadata_fallback",
      acquisitionSource: "scrapingbee_metadata",
      capturedAt: new Date().toISOString(),
    };
  }
}

/** Provider endpoint first, public profile page when it fails. */
export async function acquireInstagramEvidence(opts: {
  apiKey: string;
  username: string;
  sessionCookie?: string | null;
  /** Apify is the primary Instagram acquisition path when configured — see docs/scrape/scrape.md. */
  apifyToken?: string | string[] | null;
}): Promise<InstagramAcquisitionInput> {
  if (opts.apifyToken) {
    const viaApify = await fetchInstagramEvidenceViaApify({ token: opts.apifyToken, username: opts.username });
    if (viaApify.user) return viaApify;
  }
  const primary = await fetchInstagramEvidence(opts);
  if (primary.user) return primary;
  return fetchInstagramEvidenceViaMetadata({ apiKey: opts.apiKey, username: opts.username });
}

function extractJsonString(html: string, key: string): string | null {
  const match = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match) return null;
  try {
    const value = JSON.parse(`"${match[1]}"`) as string;
    return value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseCompact(raw: string): number {
  const match = raw.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? "").toUpperCase()] ?? 1;
  return Math.round(Number(match[1]) * multiplier);
}

/** Extracts an Instagram username from any profile URL form the operator pastes. */
export function usernameFromInstagramUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/instagram\.com/i.test(trimmed)) {
    return /^[A-Za-z0-9._]{1,30}$/.test(trimmed.replace(/^@/, ""))
      ? trimmed.replace(/^@/, "").toLowerCase()
      : null;
  }
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const segment = url.pathname.split("/").filter(Boolean)[0];
    if (!segment) return null;
    if (["p", "reel", "reels", "stories", "explore", "tv"].includes(segment.toLowerCase())) {
      return null;
    }
    return segment.toLowerCase();
  } catch {
    return null;
  }
}
