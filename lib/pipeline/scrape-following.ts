import "server-only";
import { scrapeFollowing as apifyFollowing, scrapeFollowingDetailed as apifyFollowingDetailed, type DiscoveredFollowing } from "@/lib/apify/actors";
import { scrapeFollowingViaScrapingBee } from "@/lib/scrapingbee/instagram";
import { scrapeFollowingViaProxy } from "@/lib/proxy/instagram";
import { fetchFollowingDirect } from "@/lib/instagram/direct";
import { logError } from "@/lib/pipeline/persist";
import type { AppSettings } from "@/lib/types";
import type { ProxyCreds } from "@/lib/proxy/client";

function resolveProxyCreds(settings: AppSettings): ProxyCreds | null {
  const p = settings.proxy_provider ?? "iproyal";
  if (p === "9proxy" && settings.nineproxy_user && settings.nineproxy_pass)
    return { user: settings.nineproxy_user, pass: settings.nineproxy_pass, provider: "9proxy" };
  if (p === "dataimpulse" && settings.dataimpulse_user && settings.dataimpulse_pass)
    return { user: settings.dataimpulse_user, pass: settings.dataimpulse_pass, provider: "dataimpulse" };
  if (settings.iproyal_user && settings.iproyal_pass)
    return { user: settings.iproyal_user, pass: settings.iproyal_pass, provider: "iproyal" };
  return null;
}

export async function scrapeFollowingDetailedWithFallback(opts: {
  username: string;
  settings: AppSettings;
  apifyToken: string | null;
  crawl_job_id?: string | null;
  limitOverride?: number | null;
}): Promise<{ items: DiscoveredFollowing[]; provider: "proxy" | "cookie" | "apify" | "scrapingbee" }> {
  const { username, settings, apifyToken } = opts;
  const sbKey = settings.scrapingbee_api_key || process.env.SCRAPINGBEE_API_KEY || "";
  const singleCookie = (settings.instagram_session_cookie || process.env.INSTAGRAM_SESSION_COOKIE || "").trim();
  const cookiePool = settings.instagram_cookies || null;
  const provider = settings.following_scraper_provider;
  const limit = opts.limitOverride && opts.limitOverride > 0
    ? opts.limitOverride
    : settings.max_profiles_per_account;

  const proxyCreds = resolveProxyCreds(settings);
  const hasProxy = !!proxyCreds;
  const hasCookie = !!(singleCookie || cookiePool);

  // 1. Proxy + cookie (cheapest — hits IG directly via residential IP)
  const tryProxy = async (): Promise<DiscoveredFollowing[]> => {
    if (!hasProxy) throw new Error("No proxy credentials configured");
    if (!hasCookie) throw new Error("No IG session cookie configured for proxy path");
    const usernames = await scrapeFollowingViaProxy({
      username,
      limit,
      sessionCookie: singleCookie || null,
      cookiePool,
      proxyCreds,
    });
    return usernames.map((u) => ({
      username: u.toLowerCase(),
      full_name: null,
      is_private: false,
      is_verified: false,
      profile_pic_url: null,
      ig_user_id: null,
    }));
  };

  // 2. Direct cookie fetch (no proxy, uses burner account)
  const tryCookie = async (): Promise<DiscoveredFollowing[]> => {
    if (!singleCookie) throw new Error("IG session cookie not configured");
    return fetchFollowingDirect({ username, sessionCookie: singleCookie, limit });
  };

  // 3. Apify actor
  const tryApify = async (): Promise<DiscoveredFollowing[]> => {
    if (!apifyToken) throw new Error("Apify token not configured");
    const items = await apifyFollowingDetailed({ token: apifyToken, username, limit });
    return items.slice(0, limit);
  };

  // 4. ScrapingBee
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
  if (provider === "proxy") {
    return { items: await tryProxy(), provider: "proxy" };
  }
  if (provider === "scrapingbee") {
    return { items: await trySb(), provider: "scrapingbee" };
  }
  if (provider === "apify") {
    return { items: await tryApify(), provider: "apify" };
  }

  // Auto: proxy+cookie wins when both are configured, then cookie-only, then Apify, then SB
  if (hasProxy && hasCookie) {
    try {
      return { items: await tryProxy(), provider: "proxy" };
    } catch (err) {
      await logError({
        context: "proxy.following.fallback",
        error_message: `Proxy path failed, falling back: ${err instanceof Error ? err.message : String(err)}`,
        payload: { username },
        crawl_job_id: opts.crawl_job_id ?? null,
      });
    }
  }

  if (singleCookie) {
    try {
      return { items: await tryCookie(), provider: "cookie" };
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
    return { items: await tryApify(), provider: "apify" };
  } catch (apifyErr) {
    const apifyMsg = apifyErr instanceof Error ? apifyErr.message : String(apifyErr);
    if (!sbKey) throw apifyErr;
    await logError({
      context: "apify.following.fallback",
      error_message: `Apify failed, trying ScrapingBee: ${apifyMsg}`,
      payload: { username },
      crawl_job_id: opts.crawl_job_id ?? null,
    });
    return { items: await trySb(), provider: "scrapingbee" };
  }
}
