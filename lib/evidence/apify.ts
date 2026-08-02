/*
 * Apify Instagram profile acquisition for the evidence layer.
 *
 * A deliberate duplicate of the run+poll logic in lib/apify/client.ts minus
 * the `server-only` import, so the acquisition layer stays runnable under
 * `tsx` for tests, fixtures, and the qualification CLI — same rationale as
 * lib/evidence/http.ts's ScrapingBee duplicate.
 *
 * Apify is the standard Instagram acquisition path here, matching the
 * legacy pipeline (see docs/scrape/scrape.md: "Apify is now the standard
 * path; the cookie is the fallback"). instagram.ts's ScrapingBee/cookie path
 * is the fallback for when Apify fails or returns nothing.
 */

import type { InstagramAcquisitionInput, RawInstagramUser } from "./instagram";

const APIFY_BASE = "https://api.apify.com/v2";
const PROFILE_ACTOR = process.env.APIFY_PROFILE_ACTOR || "apify~instagram-profile-scraper";

class ApifyError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApifyError";
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProfileActor(opts: {
  token: string;
  username: string;
  timeoutSecs?: number;
}): Promise<Record<string, unknown>[]> {
  const { token, username, timeoutSecs = 180 } = opts;

  const startRes = await fetch(
    `${APIFY_BASE}/acts/${PROFILE_ACTOR}/runs?token=${token}&timeout=${timeoutSecs}&memory=1024`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [username],
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: "details",
        resultsLimit: 1,
      }),
    },
  );
  if (!startRes.ok) {
    throw new ApifyError(`Apify profile actor start failed: ${startRes.status}`, startRes.status);
  }
  const startData = (await startRes.json()) as { data: { id: string; defaultDatasetId: string } };
  const { id: runId, defaultDatasetId } = startData.data;

  const POLL_INTERVAL_MS = 4_000;
  const deadline = Date.now() + (timeoutSecs + 60) * 1000;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const pollRes = await fetch(`${APIFY_BASE}/acts/${PROFILE_ACTOR}/runs/${runId}?token=${token}`);
    if (!pollRes.ok) break;
    const { data } = (await pollRes.json()) as { data: { status: string } };
    if (data.status === "SUCCEEDED") break;
    if (data.status === "FAILED" || data.status === "ABORTED" || data.status === "TIMED-OUT") {
      throw new ApifyError(`Apify profile actor run ${data.status.toLowerCase()}`);
    }
  }

  const itemsRes = await fetch(
    `${APIFY_BASE}/datasets/${defaultDatasetId}/items?token=${token}&format=json&clean=true`,
  );
  if (!itemsRes.ok) {
    throw new ApifyError(`Apify dataset fetch failed: ${itemsRes.status}`, itemsRes.status);
  }
  return (await itemsRes.json()) as Record<string, unknown>[];
}

const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
};
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Maps one Apify profile-actor dataset item into the shared RawInstagramUser evidence contract. */
function mapApifyItemToRawUser(it: Record<string, unknown>): RawInstagramUser | null {
  const username = str(it.username) ?? str(it.ownerUsername);
  if (!username) return null;

  const posts = Array.isArray(it.latestPosts) ? (it.latestPosts as Record<string, unknown>[]) : [];
  const edges = posts.map((p) => ({
    node: {
      id: str(p.id),
      shortcode: str(p.shortCode) ?? str(p.shortcode),
      is_video: str(p.type) === "Video" || str(p.productType) === "clips",
      video_view_count: num(p.videoViewCount) ?? num(p.videoPlayCount),
      edge_liked_by: { count: num(p.likesCount) },
      edge_media_to_comment: { count: num(p.commentsCount) },
      edge_media_to_caption: str(p.caption)
        ? { edges: [{ node: { text: str(p.caption) } }] }
        : undefined,
      taken_at_timestamp: str(p.timestamp)
        ? Math.floor(new Date(p.timestamp as string).getTime() / 1000)
        : undefined,
      // ⚠️ isPinned mapping is UNVERIFIED against a real dataset item — confirm
      // the profile actor actually reports this field before trusting
      // pinned_posts_capture_status="captured" for Apify-sourced evidence.
      // The key is always present (empty array when not pinned) so
      // normalizeInstagramEvidence's pinnedMarkerSeen check treats this
      // provider as reporting pinning at all, not silently omitting it.
      pinned_for_users: Boolean(p.isPinned ?? p.is_pinned) ? ["apify"] : [],
    },
  }));

  return {
    username,
    full_name: str(it.fullName) ?? str(it.full_name),
    biography: str(it.biography) ?? str(it.bio),
    external_url: str(it.externalUrl) ?? str(it.external_url),
    category_name: str(it.businessCategoryName) ?? str(it.categoryName),
    is_verified: Boolean(it.verified ?? it.isVerified),
    is_private: Boolean(it.private ?? it.isPrivate),
    edge_followed_by: { count: num(it.followersCount) ?? num(it.followers) },
    edge_follow: { count: num(it.followsCount) ?? num(it.following) },
    edge_owner_to_timeline_media: { count: num(it.postsCount) ?? num(it.posts), edges },
  };
}

/**
 * Instagram profile + recent posts via the Apify profile actor — the
 * primary acquisition path. Rotates across multiple tokens on a plausible
 * usage-limit failure (HTTP 403), same behavior as lib/apify/client.ts.
 */
export async function fetchInstagramEvidenceViaApify(opts: {
  token: string | string[];
  username: string;
}): Promise<InstagramAcquisitionInput> {
  const tokens = Array.isArray(opts.token) ? opts.token : [opts.token];
  let lastErr: unknown;

  for (const token of tokens) {
    try {
      const items = await runProfileActor({ token, username: opts.username });
      const user = items[0] ? mapApifyItemToRawUser(items[0]) : null;
      return {
        username: opts.username,
        user,
        providerError: user ? null : "apify_profile_not_returned",
        extractionMethod: "provider",
        acquisitionSource: "apify",
        capturedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastErr = err;
      if (err instanceof ApifyError && err.status === 403) continue; // try next token
      break; // non-limit error — don't rotate, fall through to error result
    }
  }

  return {
    username: opts.username,
    user: null,
    providerError: lastErr instanceof Error ? lastErr.message : String(lastErr ?? "apify call failed"),
    extractionMethod: "provider",
    acquisitionSource: "apify",
    capturedAt: new Date().toISOString(),
  };
}
