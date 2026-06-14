import "server-only";
import { scrapeFollowing as apifyFollowing, scrapeFollowingDetailed as apifyFollowingDetailed, type DiscoveredFollowing } from "@/lib/apify/actors";
import { scrapeFollowingViaScrapingBee } from "@/lib/scrapingbee/instagram";
import { fetchFollowingDirect } from "@/lib/instagram/direct";
import { logError } from "@/lib/pipeline/persist";
import type { AppSettings } from "@/lib/types";

export async function scrapeFollowingDetailedWithFallback(opts: {
  username: string;
  settings: AppSettings;
  apifyToken: string | null;
  crawl_job_id?: string | null;
  limitOverride?: number | null;
  startCursor?: string | null;
}): Promise<{ items: DiscoveredFollowing[]; provider: "cookie" | "apify" | "scrapingbee"; nextCursor: string | null }> {
  const { username, settings, apifyToken } = opts;
  const sbKey = settings.scrapingbee_api_key || process.env.SCRAPINGBEE_API_KEY || "";
  const singleCookie = (settings.instagram_session_cookie || process.env.INSTAGRAM_SESSION_COOKIE || "").trim();
  const provider = settings.following_scraper_provider;
  const limit = opts.limitOverride && opts.limitOverride > 0
    ? opts.limitOverride
    : settings.max_profiles_per_account;

  // 1. Direct cookie fetch (uses a burner-account session cookie via IG's API)
  const tryCookie = async () => {
    if (!singleCookie) throw new Error("IG session cookie not configured");
    return fetchFollowingDirect({ username, sessionCookie: singleCookie, limit, startCursor: opts.startCursor });
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
    const usernames = await scrapeFollowingViaScrapingBee({
      apiKey: sbKey,
      username,
      limit,
      sessionCookie: singleCookie || null,
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

  // Auto: cookie first, then Apify, then ScrapingBee
  if (singleCookie) {
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
