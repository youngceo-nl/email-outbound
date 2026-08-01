/*
 * Pure parsing and normalization for the Playwright Instagram proof of concept.
 *
 * EXPERIMENT ONLY. Nothing here is imported by the production qualification
 * pipeline; it lives under scripts/experiments/ on purpose.
 *
 * Deliberately free of any browser or network dependency so every function is
 * unit-testable without launching Chromium. The acquisition script owns
 * navigation; this module owns interpretation.
 *
 * Instagram serves the same logical data through at least three response
 * shapes (legacy GraphQL `edge_*`, the mobile v1 `items` API, and the newer
 * `xdt_api__v1__*` GraphQL bridge), and rotates between them without notice.
 * Every parser here accepts all of them and reports what it could not read
 * rather than silently returning an empty result.
 */

import { classifyHighlight } from "@/lib/qualification/scorecard";

// ---------------------------------------------------------------------------
// Capture state
// ---------------------------------------------------------------------------

/*
 * Mirrors lib/qualification/types.ts. The distinction the whole qualification
 * spec rests on: `captured` with an empty payload means "we looked and found
 * nothing". The other three mean "we do not know", and must never be presented
 * as evidence of absence.
 */
export type CaptureStatus = "captured" | "unavailable" | "failed" | "not_attempted";

export type CaptureSource = "network" | "dom" | "none";

// ---------------------------------------------------------------------------
// Number and text helpers
// ---------------------------------------------------------------------------

/**
 * Parses the compact counts Instagram renders in the DOM: "46K", "1.2M",
 * "2,217", "1 234". Returns null when no number is present, so an unreadable
 * count stays unknown rather than collapsing to zero.
 */
export function parseCompactCount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  // Strip thin/non-breaking spaces Instagram uses as thousands separators.
  const cleaned = text.replace(/[   ]/g, "").replace(/,/g, "");
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? "").toUpperCase()] ?? 1;
  return Math.round(value * multiplier);
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// URL sanitization
// ---------------------------------------------------------------------------

/*
 * Query parameters that can carry session or credential material. Instagram CDN
 * URLs also carry `oh`/`oe` signature pairs; those are media signatures rather
 * than account credentials, but they are dropped anyway because this experiment
 * never downloads media and a signed URL in a saved report is needless exposure.
 */
const SENSITIVE_QUERY_PARAMS = [
  "sig", "signature", "token", "access_token", "auth", "authorization",
  "api_key", "apikey", "key", "password", "passwd", "secret",
  "session", "sessionid", "session_id", "csrf", "csrftoken",
  "_nc_sid", "oh", "oe", "__a", "__s", "jazoest", "lsd", "fb_dtsg",
  "ig_sig", "shbid", "shbsid", "proxy", "proxy_auth",
];

/**
 * Strips credential-bearing query parameters. Returns null for unparseable or
 * non-HTTP input so nothing unexpected reaches the report.
 */
export function sanitizeUrl(raw: string | null | undefined): string | null {
  const text = nonEmpty(raw);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMS.includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/*
 * Object keys that must never be written to disk, matched case-insensitively
 * against any nesting depth of a stored response body.
 */
const SENSITIVE_KEY_PATTERN =
  /(cookie|authorization|auth_token|access_token|session|sessionid|csrf|password|passwd|secret|api_key|apikey|bearer|set-cookie|x-ig-www-claim|proxy)/i;

export type SanitizeOptions = { maxBytes?: number; maxDepth?: number };

/**
 * Recursively removes credential-bearing keys and truncates oversized bodies.
 * String values that look like URLs are passed through sanitizeUrl.
 */
export function sanitizeDeep(value: unknown, options: SanitizeOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 12;

  const walk = (node: unknown, depth: number): unknown => {
    if (depth > maxDepth) return "[max-depth]";
    if (node === null || node === undefined) return null;

    if (typeof node === "string") {
      if (/^https?:\/\//i.test(node)) return sanitizeUrl(node) ?? "[unparseable-url]";
      return node.length > 4000 ? `${node.slice(0, 4000)}…[truncated]` : node;
    }
    if (typeof node === "number" || typeof node === "boolean") return node;
    if (Array.isArray(node)) return node.slice(0, 200).map((item) => walk(item, depth + 1));

    if (typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          out[key] = "[redacted]";
          continue;
        }
        out[key] = walk(item, depth + 1);
      }
      return out;
    }
    return null;
  };

  const sanitized = walk(value, 0);
  const maxBytes = options.maxBytes;
  if (maxBytes) {
    const serialized = JSON.stringify(sanitized);
    if (serialized && serialized.length > maxBytes) {
      return { _truncated: true, _original_bytes: serialized.length, preview: serialized.slice(0, maxBytes) };
    }
  }
  return sanitized;
}

/**
 * Strips <script> blocks and inline JSON payloads from HTML before it is stored
 * for a failed-parser diagnostic. Instagram embeds session state in those tags.
 */
export function sanitizeHtmlForDiagnostics(html: string, maxBytes = 20000): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "<script>[removed]</script>")
    .replace(/<link[^>]*>/gi, "")
    .replace(/(csrf_token|sessionid|ds_user_id|x-ig-www-claim|access_token)["':=\s]+[^"'&<\s]+/gi, "$1=[redacted]");
  return stripped.length > maxBytes ? `${stripped.slice(0, maxBytes)}\n<!-- truncated -->` : stripped;
}

// ---------------------------------------------------------------------------
// Post normalization
// ---------------------------------------------------------------------------

export type NormalizedPost = {
  post_id: string;
  shortcode: string | null;
  url: string | null;
  caption: string | null;
  taken_at: string | null;
  media_type: "image" | "video" | "carousel" | "unknown";
  is_video: boolean;
  is_reel: boolean;
  is_pinned: boolean;
  likes: number | null;
  comments: number | null;
  views: number | null;
  thumbnail_url: string | null;
  capture_source: CaptureSource;
  capture_status: CaptureStatus;
};

/*
 * `media_type` is numeric in the v1 API (1 image, 2 video, 8 carousel) but the
 * legacy GraphQL shape only exposes `is_video`. Product type distinguishes a
 * Reel ("clips") from an ordinary video post.
 */
function resolveMediaType(node: Record<string, unknown>): {
  media_type: NormalizedPost["media_type"];
  is_video: boolean;
  is_reel: boolean;
} {
  const numeric = firstNumber(node.media_type);
  const productType = nonEmpty(node.product_type) ?? nonEmpty(node.__typename);
  const isReel =
    productType === "clips" ||
    node.clips_metadata !== undefined ||
    /reel|clips/i.test(productType ?? "");

  if (numeric === 8) return { media_type: "carousel", is_video: false, is_reel: false };
  if (numeric === 2) return { media_type: "video", is_video: true, is_reel: Boolean(isReel) };
  if (numeric === 1) return { media_type: "image", is_video: false, is_reel: false };

  const isVideo = node.is_video === true;
  const typename = nonEmpty(node.__typename) ?? "";
  if (/Sidecar/i.test(typename)) return { media_type: "carousel", is_video: false, is_reel: false };
  if (isVideo) return { media_type: "video", is_video: true, is_reel: Boolean(isReel) };
  if (typename) return { media_type: "image", is_video: false, is_reel: false };
  return { media_type: "unknown", is_video: false, is_reel: false };
}

/*
 * Pinning is reported through two different arrays depending on response shape,
 * and neither is present at all on some surfaces. Returning null (rather than
 * false) when no marker exists is what lets the caller report `unavailable`
 * instead of claiming the profile has no pinned posts.
 */
export function detectPinned(node: Record<string, unknown>): boolean | null {
  const v1 = node.timeline_pinned_user_ids;
  if (Array.isArray(v1)) return v1.length > 0;
  const graphql = node.pinned_for_users;
  if (Array.isArray(graphql)) return graphql.length > 0;
  if (typeof node.is_pinned === "boolean") return node.is_pinned;
  return null;
}

function extractCaption(node: Record<string, unknown>): string | null {
  const caption = node.caption;
  if (typeof caption === "string") return nonEmpty(caption);
  if (caption && typeof caption === "object") {
    const text = (caption as Record<string, unknown>).text;
    if (typeof text === "string") return nonEmpty(text);
  }
  const edges = (node.edge_media_to_caption as { edges?: Array<{ node?: { text?: string } }> } | undefined)
    ?.edges;
  if (Array.isArray(edges) && edges.length > 0) return nonEmpty(edges[0]?.node?.text);
  return null;
}

function extractThumbnail(node: Record<string, unknown>): string | null {
  const candidates = (node.image_versions2 as { candidates?: Array<{ url?: string }> } | undefined)
    ?.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const url = sanitizeUrl(candidates[0]?.url);
    if (url) return url;
  }
  for (const key of ["thumbnail_url", "display_url", "thumbnail_src", "display_src"]) {
    const url = sanitizeUrl(node[key] as string | undefined);
    if (url) return url;
  }
  return null;
}

/**
 * Normalizes one post node from any known Instagram response shape. Returns
 * null when the node carries no usable identifier — a node we cannot address is
 * not evidence.
 */
export function normalizePost(
  raw: unknown,
  source: CaptureSource = "network",
): NormalizedPost | null {
  if (!raw || typeof raw !== "object") return null;
  // Both `{node: {...}}` (GraphQL edges) and bare items are accepted.
  const node = ((raw as Record<string, unknown>).node ?? raw) as Record<string, unknown>;

  const shortcode = nonEmpty(node.code) ?? nonEmpty(node.shortcode);
  const id = nonEmpty(node.pk) ?? nonEmpty(node.id) ?? shortcode;
  if (!id) return null;

  const { media_type, is_video, is_reel } = resolveMediaType(node);

  // v1 uses unix seconds; legacy GraphQL uses taken_at_timestamp, also seconds.
  const takenAtRaw = firstNumber(node.taken_at, node.taken_at_timestamp, node.device_timestamp);
  const takenAt =
    takenAtRaw !== null && takenAtRaw > 0
      ? new Date((takenAtRaw > 1e12 ? takenAtRaw / 1000 : takenAtRaw) * 1000).toISOString()
      : null;

  const likes = firstNumber(
    node.like_count,
    (node.edge_liked_by as { count?: number } | undefined)?.count,
    (node.edge_media_preview_like as { count?: number } | undefined)?.count,
  );
  const comments = firstNumber(
    node.comment_count,
    (node.edge_media_to_comment as { count?: number } | undefined)?.count,
    (node.edge_media_preview_comment as { count?: number } | undefined)?.count,
  );
  const views = firstNumber(
    node.play_count,
    node.ig_play_count,
    node.view_count,
    node.video_view_count,
    node.video_play_count,
  );

  const pinned = detectPinned(node);

  return {
    post_id: String(id),
    shortcode,
    url: shortcode ? `https://www.instagram.com/p/${shortcode}/` : null,
    caption: extractCaption(node),
    taken_at: takenAt,
    media_type,
    is_video,
    is_reel,
    is_pinned: pinned === true,
    likes,
    comments,
    views,
    thumbnail_url: extractThumbnail(node),
    capture_source: source,
    capture_status: "captured",
  };
}

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------

export type ParsedProfile = {
  username: string | null;
  display_name: string | null;
  biography: string | null;
  category: string | null;
  external_link: string | null;
  followers: number | null;
  following: number | null;
  total_posts: number | null;
  is_verified: boolean | null;
  is_private: boolean | null;
  profile_pic_url: string | null;
  user_id: string | null;
};

/** Finds the first object anywhere in a response that looks like a user record. */
function findUserObject(root: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || !root || typeof root !== "object") return null;

  const node = root as Record<string, unknown>;
  const looksLikeUser =
    typeof node.username === "string" &&
    ("biography" in node ||
      "edge_followed_by" in node ||
      "follower_count" in node ||
      "profile_pic_url" in node);
  if (looksLikeUser) return node;

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      const found = findUserObject(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function parseProfileResponse(body: unknown): ParsedProfile | null {
  const user = findUserObject(body);
  if (!user) return null;

  const bioLinks = user.bio_links as Array<{ url?: string; lynx_url?: string }> | undefined;
  const externalFromLinks = Array.isArray(bioLinks) && bioLinks.length > 0
    ? sanitizeUrl(bioLinks[0]?.url ?? bioLinks[0]?.lynx_url)
    : null;

  return {
    username: nonEmpty(user.username),
    display_name: nonEmpty(user.full_name),
    biography: nonEmpty(user.biography),
    category: nonEmpty(user.category_name) ?? nonEmpty(user.category) ?? nonEmpty(user.business_category_name),
    external_link:
      externalFromLinks ?? sanitizeUrl(user.external_url as string | undefined) ?? null,
    followers: firstNumber(
      user.follower_count,
      (user.edge_followed_by as { count?: number } | undefined)?.count,
    ),
    following: firstNumber(
      user.following_count,
      (user.edge_follow as { count?: number } | undefined)?.count,
    ),
    total_posts: firstNumber(
      user.media_count,
      (user.edge_owner_to_timeline_media as { count?: number } | undefined)?.count,
    ),
    is_verified: typeof user.is_verified === "boolean" ? user.is_verified : null,
    is_private: typeof user.is_private === "boolean" ? user.is_private : null,
    profile_pic_url: sanitizeUrl(
      (user.profile_pic_url_hd as string | undefined) ?? (user.profile_pic_url as string | undefined),
    ),
    user_id: nonEmpty(user.pk) ?? nonEmpty(user.id),
  };
}

/**
 * Pulls post nodes out of any timeline/reels response shape. Collects from
 * every recognized container so one response carrying two shapes is fully read.
 */
export function parsePostsResponse(body: unknown, source: CaptureSource = "network"): NormalizedPost[] {
  const collected: unknown[] = [];

  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || !node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;

    // v1 mobile API and reels tray
    if (Array.isArray(record.items)) collected.push(...record.items);
    // GraphQL connections
    if (Array.isArray(record.edges)) collected.push(...record.edges);

    for (const [key, value] of Object.entries(record)) {
      // `media` wrappers appear inside v1 feed items.
      if (key === "media" && value && typeof value === "object") collected.push(value);
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  };
  walk(body, 0);

  const seen = new Set<string>();
  const posts: NormalizedPost[] = [];
  for (const candidate of collected) {
    const post = normalizePost(candidate, source);
    if (!post || seen.has(post.post_id)) continue;
    seen.add(post.post_id);
    posts.push(post);
  }
  return posts;
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

export type HighlightGroupLabel = "Proof" | "Offer" | "Funnel" | "Authority" | "Other";

export type ParsedHighlight = {
  highlight_id: string;
  title: string;
  group: HighlightGroupLabel;
  cover_url: string | null;
  capture_source: CaptureSource;
};

/*
 * Reuses the production classifier in lib/qualification/scorecard.ts so the
 * experiment groups titles exactly as the live scorecard would, then widens the
 * result to include an explicit "Other" bucket the report asks for.
 */
export function classifyHighlightTitle(title: string): HighlightGroupLabel {
  const group = classifyHighlight(title);
  if (!group) return "Other";
  return ({ proof: "Proof", offer: "Offer", funnel: "Funnel", authority: "Authority" } as const)[group];
}

/** Commercially relevant folders worth opening, per the experiment brief. */
export function isCommerciallyRelevantHighlight(title: string): boolean {
  const group = classifyHighlightTitle(title);
  return group === "Proof" || group === "Offer" || group === "Funnel";
}

export function parseHighlightTray(body: unknown): ParsedHighlight[] {
  const out: ParsedHighlight[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || !node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;

    const trays = [record.tray, record.highlights, record.edges].filter(Array.isArray) as unknown[][];
    for (const tray of trays) {
      for (const entryRaw of tray) {
        const entry = ((entryRaw as Record<string, unknown>)?.node ?? entryRaw) as Record<string, unknown>;
        if (!entry || typeof entry !== "object") continue;
        const title = nonEmpty(entry.title);
        const rawId = nonEmpty(entry.id) ?? nonEmpty(entry.pk);
        if (!title || !rawId) continue;
        // IDs arrive as "highlight:1234" or bare "1234"; normalize to the number.
        const id = rawId.replace(/^highlight:/, "");
        if (seen.has(id)) continue;
        seen.add(id);

        const cover =
          (entry.cover_media as { cropped_image_version?: { url?: string } } | undefined)
            ?.cropped_image_version?.url ??
          (entry.cover_media as { thumbnail_url?: string } | undefined)?.thumbnail_url;

        out.push({
          highlight_id: id,
          title,
          group: classifyHighlightTitle(title),
          cover_url: sanitizeUrl(cover),
          capture_source: "network",
        });
      }
    }
    for (const value of Object.values(record)) if (value && typeof value === "object") walk(value, depth + 1);
  };
  walk(body, 0);
  return out;
}

export type ParsedStoryItem = {
  item_id: string;
  taken_at: string | null;
  media_type: "image" | "video" | "unknown";
  media_url: string | null;
  visible_text: string[];
  outbound_urls: string[];
  capture_source: CaptureSource;
  capture_status: CaptureStatus;
};

/*
 * Story items carry outbound links in several places depending on sticker type:
 * `story_link_stickers` (modern), `story_cta` (legacy swipe-up), and
 * `link_text`/`web_uri` variants. All are collected.
 */
export function parseHighlightItems(body: unknown): ParsedStoryItem[] {
  const out: ParsedStoryItem[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > 10 || !node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;

    if (Array.isArray(record.items)) {
      for (const itemRaw of record.items) {
        const item = itemRaw as Record<string, unknown>;
        const id = nonEmpty(item.pk) ?? nonEmpty(item.id);
        // Story items always carry taken_at; a bare `items` array elsewhere
        // (e.g. a carousel) would otherwise be misread as stories.
        if (!id || item.taken_at === undefined) continue;
        if (seen.has(id)) continue;
        seen.add(id);

        const outbound = new Set<string>();
        const text: string[] = [];

        const stickers = item.story_link_stickers;
        if (Array.isArray(stickers)) {
          for (const sticker of stickers) {
            const link = (sticker as Record<string, unknown>)?.story_link as
              | { url?: string; link_title?: string }
              | undefined;
            const url = sanitizeUrl(link?.url);
            if (url) outbound.add(url);
            const title = nonEmpty(link?.link_title);
            if (title) text.push(title);
          }
        }
        const cta = item.story_cta;
        if (Array.isArray(cta)) {
          for (const entry of cta) {
            const links = (entry as Record<string, unknown>)?.links;
            if (Array.isArray(links)) {
              for (const link of links) {
                const url = sanitizeUrl((link as Record<string, unknown>)?.webUri as string | undefined);
                if (url) outbound.add(url);
              }
            }
          }
        }
        const accessibility = nonEmpty(item.accessibility_caption);
        if (accessibility) text.push(accessibility);

        const numeric = firstNumber(item.media_type);
        const mediaType: ParsedStoryItem["media_type"] =
          numeric === 2 ? "video" : numeric === 1 ? "image" : "unknown";

        const takenAt = firstNumber(item.taken_at);

        out.push({
          item_id: String(id),
          taken_at: takenAt ? new Date(takenAt * 1000).toISOString() : null,
          media_type: mediaType,
          media_url: extractThumbnail(item),
          visible_text: text,
          outbound_urls: [...outbound],
          capture_source: "network",
          capture_status: "captured",
        });
      }
    }
    for (const value of Object.values(record)) if (value && typeof value === "object") walk(value, depth + 1);
  };
  walk(body, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Response routing
// ---------------------------------------------------------------------------

export type ResponseKind =
  | "profile"
  | "timeline"
  | "reels"
  | "highlight_tray"
  | "highlight_items"
  | "other";

/**
 * Classifies an Instagram response URL so the interceptor knows which parser to
 * run. Matches on path and GraphQL operation name, both of which Instagram
 * changes less often than response shape.
 */
export function classifyResponseUrl(url: string, requestBody?: string | null): ResponseKind {
  const lower = url.toLowerCase();
  const body = (requestBody ?? "").toLowerCase();

  if (lower.includes("/api/v1/users/web_profile_info")) return "profile";
  if (lower.includes("/api/v1/users/") && lower.includes("/info")) return "profile";
  if (lower.includes("highlights_tray") || body.includes("highlightsv3")) return "highlight_tray";
  if (lower.includes("reels_media") || body.includes("reels_media")) return "highlight_items";
  if (lower.includes("/api/v1/feed/user/")) return "timeline";
  if (lower.includes("/api/v1/clips/user")) return "reels";

  if (lower.includes("/graphql")) {
    if (body.includes("profiletimeline") || body.includes("feed__user_timeline")) return "timeline";
    if (body.includes("profilereels") || body.includes("clips__user")) return "reels";
    if (body.includes("profilepostsquery") || body.includes("postsquery")) return "timeline";
    if (body.includes("profilepagecontent") || body.includes("userbyusername")) return "profile";
    return "other";
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Field completeness
// ---------------------------------------------------------------------------

/*
 * The fields the commercial qualification pipeline consumes. Grouped so the
 * report can state precisely which surfaces a browser-only acquisition can and
 * cannot replace.
 */
export const REQUIRED_FIELDS = [
  "profile.username",
  "profile.display_name",
  "profile.biography",
  "profile.category",
  "profile.external_link",
  "profile.followers",
  "profile.following",
  "profile.total_posts",
  "profile.is_verified",
  "profile.is_private",
  "profile.profile_pic_url",
  "recent_posts",
  "recent_posts.caption",
  "recent_posts.taken_at",
  "recent_posts.likes",
  "recent_posts.comments",
  "recent_posts.views",
  "pinned_posts",
  // Highlight CONTENTS are deliberately out of scope: opening a folder marks the
  // story seen for the owner. Titles alone carry the scorecard's signal.
  "highlights.titles",
  "external_destinations",
] as const;

export type FieldCompleteness = {
  captured_fields: string[];
  missing_fields: string[];
  unknown_fields: string[];
};

/**
 * Splits required fields three ways. `missing` means the surface was read and
 * the field genuinely was not there; `unknown` means acquisition failed, so the
 * field's absence proves nothing.
 */
export function computeFieldCompleteness(input: {
  present: Record<string, boolean>;
  surfaceStatus: Record<string, CaptureStatus>;
  fieldSurface: Record<string, string>;
}): FieldCompleteness {
  const captured: string[] = [];
  const missing: string[] = [];
  const unknown: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    const surface = input.fieldSurface[field] ?? "profile";
    const status = input.surfaceStatus[surface] ?? "not_attempted";

    if (input.present[field]) {
      captured.push(field);
    } else if (status === "captured") {
      missing.push(field);
    } else {
      unknown.push(field);
    }
  }
  return { captured_fields: captured, missing_fields: missing, unknown_fields: unknown };
}

// ---------------------------------------------------------------------------
// Challenge detection
// ---------------------------------------------------------------------------

export type ChallengeKind =
  | "login_required"
  | "checkpoint"
  | "rate_limited"
  | "captcha"
  | "none";

/**
 * Detects Instagram security surfaces from a URL and page text. This exists to
 * REPORT blocks, never to circumvent them — the acquisition script stops when
 * any of these fire.
 */
export function detectChallenge(url: string, pageText: string): ChallengeKind {
  const lowerUrl = url.toLowerCase();
  const text = pageText.slice(0, 5000).toLowerCase();

  if (lowerUrl.includes("/challenge") || text.includes("we detected an unusual login")) return "checkpoint";
  if (lowerUrl.includes("/accounts/login")) return "login_required";
  if (text.includes("please wait a few minutes") || text.includes("try again later")) return "rate_limited";
  if (text.includes("captcha") || text.includes("confirm you're a human")) return "captcha";
  return "none";
}
