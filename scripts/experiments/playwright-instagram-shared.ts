/*
 * Shared browser configuration for the Playwright Instagram experiment.
 *
 * EXPERIMENT ONLY. Keeping the browser identity in one place means the headed
 * login bootstrap and the headless acquisition run present themselves
 * identically — a session established under one fingerprint and replayed under
 * another is exactly what trips Instagram's checkpoint.
 */

import { mkdirSync } from "node:fs";
import type { BrowserContext, Route } from "playwright";

export const OUTPUT_DIR = "/tmp/agency-ai-os-instagram-test";
export const PROFILE_DIR = `${OUTPUT_DIR}/chromium-profile`;

/*
 * A Chrome channel binary must not share a profile directory with bundled
 * Chromium — different browser builds writing the same profile corrupts it.
 * Each channel gets its own directory; the session is seeded from the
 * environment either way, so a fresh profile costs nothing.
 */
export function profileDirFor(channel?: string | null): string {
  return channel ? `${OUTPUT_DIR}/profile-${channel}` : PROFILE_DIR;
}

/** Fixed, realistic, and stable between runs. */
export const BROWSER_IDENTITY = {
  viewport: { width: 1440, height: 900 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  locale: "en-US",
  timezoneId: "Europe/Amsterdam",
} as const;

export function ensureOutputDir(dir: string = PROFILE_DIR): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Checks for the presence of a session cookie without reading or returning its
 * value. Nothing about the cookie is logged or written to the report.
 */
export async function isAuthenticated(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies("https://www.instagram.com");
  return cookies.some((cookie) => cookie.name === "sessionid" && cookie.value.length > 0);
}

/*
 * Seeds the browser context from the session already configured for this
 * repository (INSTAGRAM_SESSION_COOKIE), so the experiment can run without an
 * interactive login. Values are passed straight to Chromium and never logged,
 * returned, or written to the report — the boolean says only whether a session
 * was applied.
 */
export async function seedSessionFromEnv(context: BrowserContext): Promise<boolean> {
  const raw = process.env.INSTAGRAM_SESSION_COOKIE?.trim();
  if (!raw || !raw.includes("=")) return false;

  const cookies = raw
    .split(";")
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return null;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (!name || !value) return null;
      return {
        name,
        value,
        domain: ".instagram.com",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax" as const,
      };
    })
    .filter((cookie): cookie is NonNullable<typeof cookie> => cookie !== null);

  if (cookies.length === 0) return false;
  await context.addCookies(cookies);
  return true;
}

/*
 * Endpoints that CHANGE STATE on Instagram. Every one is aborted outright, so a
 * stray click or an internal client call can never follow, like, comment,
 * message, or mark a story as seen. This is a hard safety net that does not
 * depend on the script's navigation being perfect.
 */
const STATE_CHANGING_PATTERNS = [
  /\/friendships\/(create|destroy|block)/i,
  /\/web\/friendships\//i,
  /\/likes\/(like|unlike)/i,
  /\/web\/likes\//i,
  /\/comments\/(add|post|delete)/i,
  /\/media\/[^/]+\/seen/i,
  /\/stories\/reel\/seen/i,
  /\/direct_v2\//i,
  /\/accounts\/(edit|remove_profile_picture)/i,
  /\/save\/(post|unsave)/i,
];

/** Resource types safe to drop — none of them carry evidence. */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);

/** Analytics and ad hosts. Deliberately excludes Instagram/Facebook API hosts. */
const BLOCKED_HOSTS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googlesyndication.com",
  "segment.io",
  "hotjar.com",
  "sentry.io",
  "scorecardresearch.com",
];

export type RouteStats = { blockedResources: number; blockedStateChanging: number };

export type RoutingOptions = {
  /*
   * Headed runs keep images so a human watching sees a normal-looking page.
   * Evidence is unaffected — thumbnail URLs come from JSON, never from pixels.
   */
  allowImages?: boolean;
};

/**
 * Installs request routing. Scripts, documents, XHR/fetch, and GraphQL are
 * always allowed — Instagram renders nothing without them.
 */
export async function installRouting(
  context: BrowserContext,
  stats: RouteStats,
  options: RoutingOptions = {},
): Promise<void> {
  await context.route("**/*", (route: Route) => {
    const request = route.request();
    const url = request.url();

    if (STATE_CHANGING_PATTERNS.some((pattern) => pattern.test(url))) {
      stats.blockedStateChanging += 1;
      return route.abort();
    }

    const type = request.resourceType();
    const blockThis =
      options.allowImages && type === "image" ? false : BLOCKED_RESOURCE_TYPES.has(type);
    if (blockThis) {
      stats.blockedResources += 1;
      return route.abort();
    }

    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      /* fall through and allow */
    }
    if (host && BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))) {
      stats.blockedResources += 1;
      return route.abort();
    }

    return route.continue();
  });
}
