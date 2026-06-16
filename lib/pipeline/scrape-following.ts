import "server-only";
import { scrapeFollowingDetailed as apifyFollowingDetailed, type DiscoveredFollowing } from "@/lib/apify/actors";
import { scrapeFollowingViaScrapingBee } from "@/lib/scrapingbee/instagram";
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
}): Promise<{ items: DiscoveredFollowing[]; provider: "playwright" | "cookie" | "apify" | "scrapingbee"; nextCursor: string | null }> {
  const { username, settings, apifyToken } = opts;
  const sbKey = settings.scrapingbee_api_key || process.env.SCRAPINGBEE_API_KEY || "";
  const cookiePool = buildCookiePool(settings);
  const provider = settings.following_scraper_provider;
  const limit = opts.limitOverride && opts.limitOverride > 0
    ? opts.limitOverride
    : settings.max_profiles_per_account;

  // 0. Playwright — real Chromium browser, no 250-account cap
  const tryPlaywright = async (): Promise<DiscoveredFollowing[]> => {
    const available = cookiePool.filter(c => !isRateLimited(c));
    if (available.length === 0) throw new Error("No Instagram cookies available for Playwright");
    const cookie = available[0];
    const { scrapeFollowingPlaywright } = await import("@/lib/instagram/playwright-scraper");
    return scrapeFollowingPlaywright({ username, cookie, limit });
  };

  // 1. Direct cookie fetch — rotates through all burner accounts, skipping rate-limited ones
  const tryCookie = async () => {
    if (cookiePool.length === 0) throw new Error("No Instagram session cookies configured");
    const available = cookiePool.filter(c => !isRateLimited(c));
    if (available.length === 0) {
      throw new Error(`All ${cookiePool.length} Instagram cookie(s) are rate-limited — wait 2h or add more burner accounts`);
    }
    let lastErr: Error | null = null;
    for (const cookie of available) {
      try {
        return await fetchFollowingDirect({ username, sessionCookie: cookie, limit, startCursor: opts.startCursor });
      } catch (err) {
        if (err instanceof InstagramDirectError && err.status === 429) {
          markRateLimited(cookie);
          lastErr = err;
          continue; // try next burner account
        }
        throw err;
      }
    }
    throw lastErr ?? new Error("All Instagram cookies rate-limited — wait or switch to Apify");
  };

  // 2. Apify actor
  const tryApify = async (): Promise<DiscoveredFollowing[]> => {
    if (!apifyToken) throw new Error("Apify token not configured");
    const items = await apifyFollowingDetailed({ token: apifyToken, username, limit });
    return items.slice(0, limit);
  };

  // 3. ScrapingBee
  const trySb = async (): Promise<DiscoveredFollowing[]> => {
    if (!sbKey) throw new Error("ScrapingBee API key not configured");
    const availableCookie = cookiePool.find(c => !isRateLimited(c)) ?? null;
    if (!availableCookie) throw new Error("All Instagram cookies are rate-limited — ScrapingBee also needs a cookie to scrape following lists. Wait ~2h or add more burner accounts in Settings.");
    const usernames = await scrapeFollowingViaScrapingBee({
      apiKey: sbKey,
      username,
      limit,
      sessionCookie: availableCookie,
    });
    return usernames.slice(0, limit).map((u) => ({
      username: u.toLowerCase(),
      full_name: null,
      is_private: false,
      is_verified: false,
      profile_pic_url: null,
      ig_user_id: null,
    }));
  };

  // Explicit provider selection
  if (provider === "playwright") {
    return { items: await tryPlaywright(), provider: "playwright", nextCursor: null };
  }
  if (provider === "scrapingbee") {
    return { items: await trySb(), provider: "scrapingbee", nextCursor: null };
  }
  if (provider === "apify") {
    return { items: await tryApify(), provider: "apify", nextCursor: null };
  }
  if (provider === "cookie") {
    const r = await tryCookie();
    return { items: r.items, provider: "cookie", nextCursor: r.nextCursor };
  }

  // Auto: Playwright first (no cap), then cookie, then Apify, then ScrapingBee
  if (cookiePool.length > 0) {
    try {
      return { items: await tryPlaywright(), provider: "playwright", nextCursor: null };
    } catch (err) {
      await logError({
        context: "playwright.following.fallback",
        error_message: `Playwright failed, falling back to cookie: ${err instanceof Error ? err.message : String(err)}`,
        payload: { username },
        crawl_job_id: opts.crawl_job_id ?? null,
      });
    }
  }

  if (cookiePool.length > 0) {
    try {
      const r = await tryCookie();
      return { items: r.items, provider: "cookie", nextCursor: r.nextCursor };
    } catch (err) {
      await logError({
        context: "ig.cookie.following.fallback",
        error_message: `Cookie path failed, falling back: ${err instanceof Error ? err.message : String(err)}`,
        payload: { username },
        crawl_job_id: opts.crawl_job_id ?? null,
      });
    }
  }

  try {
    return { items: await tryApify(), provider: "apify", nextCursor: null };
  } catch (apifyErr) {
    const apifyMsg = apifyErr instanceof Error ? apifyErr.message : String(apifyErr);
    if (!sbKey) throw apifyErr;
    await logError({
      context: "apify.following.fallback",
      error_message: `Apify failed, trying ScrapingBee: ${apifyMsg}`,
      payload: { username },
      crawl_job_id: opts.crawl_job_id ?? null,
    });
    return { items: await trySb(), provider: "scrapingbee", nextCursor: null };
  }
}
