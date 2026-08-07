import "server-only";
import type { DiscoveredFollowing } from "@/lib/apify/actors";
import { fetchFollowingDirect, InstagramDirectError } from "@/lib/instagram/direct";
import { buildCookiePool, markRateLimited, isRateLimited } from "@/lib/instagram/cookie-pool";
import { logCrawl, logError } from "@/lib/pipeline/persist";
import { resolveHikerApiKey } from "@/lib/config/settings";
import type { AppSettings } from "@/lib/types";

export type FollowingProvider = "apify" | "playwright" | "cookie" | "colddms" | "hikerapi";

/**
 * Apify and Playwright walk the whole list in one call; this is their ceiling.
 *
 * 5000 is empirical, not arbitrary. The Apify actor advertises resultsLimit up
 * to 500000, but above ~5000 it exits SUCCEEDED with code 0 and an *empty*
 * dataset instead of failing — measured against @pierree (650 following):
 *
 *   resultsLimit=500   -> 500 items   (7.2s)
 *   resultsLimit=5000  -> 649 items   (22.0s)   <- complete list
 *   resultsLimit=7500  -> 0 items     (9.2s)
 *   resultsLimit=50000 -> 0 items     (2.1s)
 *
 * Raising this without re-testing the actor silently breaks every full crawl.
 * Instagram caps following at 7500, so this only under-fetches accounts that
 * follow more than 5000 — rare, and better than returning nothing.
 */
const FULL_ACCOUNT_TARGET = 5_000;
const PLAYWRIGHT_TIMEOUT_MS = 5 * 60 * 1000;
// ColdDMS scrapes run server-side on their end and take much longer than the
// direct-Instagram Playwright path — ~10 minutes was typical for ~700 results
// in testing.
const COLDDMS_TIMEOUT_MS = 25 * 60 * 1000;

/*
 * "This provider cannot serve any request right now" — a billing/quota state,
 * not an answer about the account being scraped. Every phrase here comes from
 * a real failure observed on 2026-08-07: Apify's account-level monthly cap
 * ("Monthly usage hard limit exceeded"), the following actor's own free-tier
 * daily cap reported inside a 200 OK ("FREE_API_DAILY_LIMIT_REACHED", surfaced
 * by lib/apify/client.ts as "reported quota exhaustion for this token"), and
 * HikerAPI's empty balance ("402 Payment Required"). Matching is deliberately
 * broad: treating a real error as unavailable only costs a wasted fallback
 * attempt, while missing one strands the operator with no list at all.
 */
function isProviderUnavailable(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("quota") ||
    m.includes("usage hard limit") ||
    m.includes("limit exceeded") ||
    m.includes("limit reached") ||
    m.includes("exhausted") ||
    m.includes("insufficient") ||
    m.includes("payment required") ||
    m.includes("balance") ||
    m.includes("no apify token") ||
    m.includes("platform-feature-disabled")
  );
}

export type FollowingResult = {
  items: DiscoveredFollowing[];
  /** The provider that actually produced these items — never what was requested. */
  provider: FollowingProvider;
  nextCursor: string | null;
  /** Set when `auto` degraded past a provider, so callers can surface it. */
  fellBackFrom?: { provider: FollowingProvider; reason: string }[];
};

/**
 * Scrapes a following list. Apify is the standard provider.
 *
 * Failures are deliberately loud. An explicitly configured provider is the
 * only one tried — if it fails, the crawl fails with that provider's real
 * error rather than quietly degrading to a different one and reporting
 * success. Only `auto` chains, and even then every downgrade is logged to the
 * pipeline and returned in `fellBackFrom`, because a silent fallback is how a
 * scrape ends up mislabelled in the job log.
 */
export async function scrapeFollowingDetailedWithFallback(opts: {
  username: string;
  settings: AppSettings;
  apifyToken: string | string[] | null;
  crawl_job_id?: string | null;
  limitOverride?: number | null;
  startCursor?: string | null;
  /** Walking the entire list — bulk providers need the real target, not a page size. */
  fullAccount?: boolean;
}): Promise<FollowingResult> {
  const { username, settings } = opts;
  const cookiePool = buildCookiePool(settings);

  const pageLimit =
    opts.limitOverride && opts.limitOverride > 0 ? opts.limitOverride : settings.max_profiles_per_account;
  // The cookie path pages with a cursor, so it wants the per-page size. Apify
  // and Playwright fetch everything in one shot, so in full-account mode
  // handing them the page size would cap the crawl at one page.
  const bulkLimit = opts.fullAccount ? FULL_ACCOUNT_TARGET : pageLimit;

  const tryApify = async (): Promise<FollowingResult> => {
    if (!opts.apifyToken || (Array.isArray(opts.apifyToken) && opts.apifyToken.length === 0)) {
      throw new Error(
        "Apify is the configured following scraper but no Apify token is set — add APIFY_TOKEN to the environment or an Apify key in Settings.",
      );
    }
    const { scrapeFollowingDetailed } = await import("@/lib/apify/actors");
    const items = await scrapeFollowingDetailed({
      token: opts.apifyToken,
      username,
      limit: bulkLimit,
    });
    if (items.length === 0) {
      // A silent empty result is the failure mode that used to look like
      // success, so it is an error here rather than an empty page.
      throw new Error(`Apify returned 0 accounts for @${username} — check the actor and its input schema.`);
    }
    // Apify handles its own pagination, so one call is the whole list.
    return { items, provider: "apify", nextCursor: null };
  };

  const tryPlaywright = async (): Promise<FollowingResult> => {
    const available = cookiePool.filter((e) => !isRateLimited(e.cookie));
    if (available.length === 0) throw new Error("No Instagram cookies available for Playwright");
    const entry = available[0];
    const { scrapeFollowingPlaywright } = await import("@/lib/instagram/playwright-scraper");
    const proxyUrl =
      entry.proxyUrl ?? settings.instagram_proxy_url ?? process.env.INSTAGRAM_PROXY_URL ?? null;
    const items = await Promise.race([
      scrapeFollowingPlaywright({ username, cookie: entry.cookie, limit: bulkLimit, proxyUrl }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Playwright timed out after 5 minutes")), PLAYWRIGHT_TIMEOUT_MS),
      ),
    ]);
    if (items.length === 0) {
      throw new Error("Playwright returned 0 accounts — the dialog likely didn't open or the UI changed.");
    }
    return { items, provider: "playwright", nextCursor: null };
  };

  const tryColdDMS = async (): Promise<FollowingResult> => {
    if (!settings.colddms_email || !settings.colddms_password) {
      throw new Error("ColdDMS is the configured following scraper but no ColdDMS email/password is set in Settings.");
    }
    const { scrapeFollowingColdDMS } = await import("@/lib/instagram/colddms-scraper");
    const items = await Promise.race([
      scrapeFollowingColdDMS({
        username,
        limit: bulkLimit,
        email: settings.colddms_email,
        password: settings.colddms_password,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ColdDMS timed out after 25 minutes")), COLDDMS_TIMEOUT_MS),
      ),
    ]);
    if (items.length === 0) {
      throw new Error(`ColdDMS returned 0 accounts for @${username}`);
    }
    // ColdDMS fetches everything in one task, same as Apify/Playwright.
    return { items, provider: "colddms", nextCursor: null };
  };

  // HikerAPI paginates internally (25/page, ~1 request per page) up to bulkLimit,
  // same "fetch everything in one call" contract as Apify/Playwright/ColdDMS from
  // the caller's perspective. Requires a funded HikerAPI balance — see Settings.
  const tryHikerApi = async (): Promise<FollowingResult> => {
    const apiKey = resolveHikerApiKey(settings);
    if (!apiKey) {
      throw new Error(
        "HikerAPI is the configured following scraper but no HikerAPI key is set — add one in Settings.",
      );
    }
    const { scrapeFollowingViaHikerApi } = await import("@/lib/hikerapi/instagram");
    const items = await scrapeFollowingViaHikerApi({ apiKey, username, limit: bulkLimit });
    if (items.length === 0) {
      throw new Error(`HikerAPI returned 0 accounts for @${username}`);
    }
    return { items, provider: "hikerapi", nextCursor: null };
  };

  const tryCookie = async (): Promise<FollowingResult> => {
    if (cookiePool.length === 0) throw new Error("No Instagram session cookies configured");
    const available = cookiePool.filter((e) => !isRateLimited(e.cookie));
    if (available.length === 0) {
      throw new Error(
        `All ${cookiePool.length} Instagram cookie(s) are rate-limited — wait ~2h or add more accounts`,
      );
    }
    let lastErr: Error | null = null;
    for (const entry of available) {
      try {
        const r = await fetchFollowingDirect({
          username,
          sessionCookie: entry.cookie,
          limit: pageLimit,
          startCursor: opts.startCursor,
          proxyUrl: entry.proxyUrl ?? settings.instagram_proxy_url ?? process.env.INSTAGRAM_PROXY_URL ?? null,
          steel: {
            steelApiKey: settings.steel_api_key,
            steelBaseUrl: settings.steel_base_url,
            cfAccessClientId: settings.steel_cf_client_id,
            cfAccessClientSecret: settings.steel_cf_client_secret,
          },
        });
        return { items: r.items, provider: "cookie", nextCursor: r.nextCursor };
      } catch (err) {
        if (err instanceof InstagramDirectError) {
          if (err.status === 429) markRateLimited(entry.cookie);
          // Try the next cookie regardless — 401 = expired, 403 = flagged, etc.
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error("All Instagram cookies exhausted");
  };

  const runners: Record<FollowingProvider, () => Promise<FollowingResult>> = {
    apify: tryApify,
    playwright: tryPlaywright,
    cookie: tryCookie,
    colddms: tryColdDMS,
    hikerapi: tryHikerApi,
  };

  // Anything not in the chain (a stale 'scrapingbee' row, say) lands on the
  // standard provider rather than silently doing nothing.
  const configured = settings.following_scraper_provider;
  const requested: FollowingProvider | "auto" =
    configured === "auto" || configured in runners ? (configured as FollowingProvider | "auto") : "apify";

  const AUTO_CHAIN: FollowingProvider[] = ["apify", "playwright", "cookie"];
  const fellBackFrom: { provider: FollowingProvider; reason: string }[] = [];

  /*
   * An explicitly requested provider is tried first and its real failures
   * still surface as its own error — a scrape must never quietly become a
   * different provider's result when the caller asked for one specifically.
   *
   * The exception is a provider that is merely UNAVAILABLE: out of monthly
   * quota, out of daily quota, or out of account balance. That says nothing
   * about the request and leaves the operator with an error instead of the
   * list they asked for, while a perfectly good provider sits unused. Those
   * fall through to the rest of the chain, and every downgrade is recorded in
   * fellBackFrom and logged, so it is visible rather than silent.
   */
  const chain: FollowingProvider[] =
    requested === "auto" ? AUTO_CHAIN : [requested, ...AUTO_CHAIN.filter((p) => p !== requested)];

  for (const [index, provider] of chain.entries()) {
    try {
      const result = await runners[provider]();
      if (fellBackFrom.length) {
        await logCrawl({
          crawl_job_id: opts.crawl_job_id ?? null,
          profile_username: username,
          parent_username: null,
          action: "provider_fallback",
          depth: 0,
          detail: `used=${provider} after ${fellBackFrom.map((f) => `${f.provider} failed (${f.reason})`).join("; ")}`,
        });
      }
      return { ...result, fellBackFrom: fellBackFrom.length ? fellBackFrom : undefined };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      /*
       * A named provider failing for a real reason (bad cookie, blocked
       * account, actor error) is that provider's answer and is reported as
       * such — only unavailability is worth trying someone else for.
       */
      if (requested !== "auto" && index === 0 && !isProviderUnavailable(reason)) {
        await logError({
          context: `scrape.following.${provider}`,
          error_message: reason,
          payload: { username, provider },
          crawl_job_id: opts.crawl_job_id ?? null,
        });
        throw new Error(`${provider} following scrape failed for @${username}: ${reason}`);
      }
      fellBackFrom.push({ provider, reason });
      await logError({
        context: `scrape.following.${provider}`,
        error_message: `${provider} failed, trying next provider: ${reason}`,
        payload: { username, provider },
        crawl_job_id: opts.crawl_job_id ?? null,
      });
    }
  }

  throw new Error(
    `All following scrapers failed for @${username}: ` +
      fellBackFrom.map((f) => `${f.provider} — ${f.reason}`).join(" | "),
  );
}
