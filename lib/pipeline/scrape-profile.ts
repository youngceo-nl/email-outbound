import "server-only";
import { fetchProfileMetadataDirect, InstagramDirectError } from "@/lib/instagram/direct";
import { buildCookiePool, pickCookie, markRateLimited } from "@/lib/instagram/cookie-pool";
import { logError } from "@/lib/pipeline/persist";
import { ensureProfileFields } from "@/lib/pipeline/normalize";
import type { AppSettings, ScrapedProfile } from "@/lib/types";

export async function scrapeProfileWithFallback(opts: {
  username: string;
  settings: AppSettings;
  apifyToken: string | null;
  crawl_job_id?: string | null;
}): Promise<{ profile: ScrapedProfile; provider: "direct" }> {
  const { username, settings } = opts;
  const pool = buildCookiePool(settings);
  const cookie = pickCookie(pool);
  if (!cookie) throw new Error("No available Instagram session cookie in pool");

  try {
    const proxyUrl = settings.instagram_proxy_url || process.env.INSTAGRAM_PROXY_URL || null;
    const meta = await fetchProfileMetadataDirect({
      username,
      sessionCookie: cookie,
      delayMs: Math.floor(Math.random() * 2000) + 500,
      proxyUrl,
    });
    if (!meta) throw new Error(`Profile not found for ${username}`);
    return {
      profile: ensureProfileFields({
        username: meta.username,
        full_name: meta.full_name,
        profile_url: `https://www.instagram.com/${meta.username}/`,
        bio: meta.bio,
        external_link: meta.external_link,
        followers: meta.followers,
        following: meta.following,
        posts: meta.posts,
        is_private: meta.is_private,
        is_verified: meta.is_verified,
        recent_posts: meta.recent_posts,
      }),
      provider: "direct",
    };
  } catch (err) {
    if (err instanceof InstagramDirectError && err.status === 429) {
      markRateLimited(cookie);
    }
    const msg = err instanceof Error ? err.message : String(err);
    await logError({
      context: "scrape.profile",
      error_message: msg,
      payload: { username },
      crawl_job_id: opts.crawl_job_id ?? null,
    });
    throw err;
  }
}
