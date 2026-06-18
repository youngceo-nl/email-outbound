import "server-only";
import type { DiscoveredFollowing } from "@/lib/apify/actors";
import { fetchFollowingDirect, InstagramDirectError } from "@/lib/instagram/direct";
import { buildCookiePool, markRateLimited, isRateLimited } from "@/lib/instagram/cookie-pool";
import { logError } from "@/lib/pipeline/persist";
import type { AppSettings } from "@/lib/types";

export async function scrapeFollowingDetailedWithFallback(opts: {
  username: string;
  settings: AppSettings;
  apifyToken: string | null;
  crawl_job_id?: string | null;
  limitOverride?: number | null;
  startCursor?: string | null;
}): Promise<{ items: DiscoveredFollowing[]; provider: "playwright" | "cookie"; nextCursor: string | null }> {
  const { username, settings } = opts;
  const cookiePool = buildCookiePool(settings);
  const limit = opts.limitOverride && opts.limitOverride > 0
    ? opts.limitOverride
    : settings.max_profiles_per_account;

  // 1. Playwright — real Chromium, best success rate, no hard cap
  const tryPlaywright = async () => {
    const available = cookiePool.filter(c => !isRateLimited(c));
    if (available.length === 0) throw new Error("No Instagram cookies available for Playwright");
    const cookie = available[0];
    const { scrapeFollowingPlaywright } = await import("@/lib/instagram/playwright-scraper");
    const items = await scrapeFollowingPlaywright({ username, cookie, limit });
    return { items, provider: "playwright" as const, nextCursor: null };
  };

  // 2. Direct cookie — rotates through pool, tracks rate limits
  const tryCookie = async () => {
    if (cookiePool.length === 0) throw new Error("No Instagram session cookies configured");
    const available = cookiePool.filter(c => !isRateLimited(c));
    if (available.length === 0) {
      throw new Error(`All ${cookiePool.length} Instagram cookie(s) are rate-limited — wait ~2h or add more accounts`);
    }
    let lastErr: Error | null = null;
    for (const cookie of available) {
      try {
        const r = await fetchFollowingDirect({ username, sessionCookie: cookie, limit, startCursor: opts.startCursor });
        return { items: r.items, provider: "cookie" as const, nextCursor: r.nextCursor };
      } catch (err) {
        if (err instanceof InstagramDirectError && err.status === 429) {
          markRateLimited(cookie);
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error("All Instagram cookies rate-limited");
  };

  // Try Playwright first, fall back to direct cookie
  try {
    return await tryPlaywright();
  } catch (err) {
    await logError({
      context: "playwright.following.fallback",
      error_message: `Playwright failed, falling back to cookie: ${err instanceof Error ? err.message : String(err)}`,
      payload: { username },
      crawl_job_id: opts.crawl_job_id ?? null,
    });
  }

  return await tryCookie();
}
