/*
 * Browser backend abstraction: local Chromium vs a Steel cloud session.
 *
 * EXPERIMENT ONLY. Both backends return a plain BrowserContext so the
 * acquisition script does not care where the browser runs.
 *
 * The important difference is not "cloud vs local" — it is session identity.
 * A logged-in Instagram session appearing from a rotating pool of IPs is the
 * single strongest ban signal there is, so Steel's own rotating proxy
 * (`useProxy: true`) is deliberately NOT the default here. The intended
 * production shape is one account pinned to one residential IP for its whole
 * life, supplied via `proxyUrl`.
 */

import { chromium, type Browser, type BrowserContext } from "playwright";
import Steel from "steel-sdk";
import { BROWSER_IDENTITY, profileDirFor } from "./playwright-instagram-shared";

export type BackendKind = "local" | "steel";

export type BrowserSession = {
  kind: BackendKind;
  context: BrowserContext;
  /** Non-null only for Steel; useful for the live viewer URL. */
  sessionId: string | null;
  debugUrl: string | null;
  /** "steel" (their pool), "external" (our pinned proxy), or null (direct). */
  proxySource?: "steel" | "external" | null;
  close: () => Promise<void>;
};

export type BackendOptions = {
  kind: BackendKind;
  headed: boolean;
  channel?: string | null;
  slowMo?: number;
  /*
   * A fixed upstream proxy in "user:pass@host:port" form. Pin ONE per account
   * and keep it stable — this is the setting that makes cloud execution safe
   * for an authenticated session rather than actively riskier than local.
   */
  proxyUrl?: string | null;
  /** Steel's own rotating pool. Appropriate for logged-out work only. */
  useRotatingProxy?: boolean;
  /*
   * Steel credential. Passed in so the production pipeline can source it from
   * app_settings (shared across the team) rather than from a per-laptop env var.
   * Falls back to STEEL_API_KEY for the CLI harness, which has no settings row.
   */
  steelApiKey?: string | null;
  /*
   * Points the Steel SDK at a self-hosted instance instead of api.steel.dev —
   * a docker run of ghcr.io/steel-dev/steel-browser-api, Apache 2.0. Cloud
   * cost moves to whichever machine runs the container; the API is identical.
   * Falls back to app_settings.steel_base_url / STEEL_BASE_URL so this stays
   * a config change, never a code change, per lead.
   */
  steelBaseUrl?: string | null;
  /** Persistent Steel profile id — one per Instagram account in production. */
  profileId?: string | null;
  /** Exact cookie header paired with this profile. Never logged. */
  sessionCookie?: string | null;
  sessionTimeoutMs?: number;
};

export async function openBrowserSession(options: BackendOptions): Promise<BrowserSession> {
  if (options.kind === "steel") return openSteelSession(options);
  return openLocalSession(options);
}

async function openLocalSession(options: BackendOptions): Promise<BrowserSession> {
  const profileDir = profileDirFor(options.channel ?? null);
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !options.headed,
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.slowMo ? { slowMo: options.slowMo } : {}),
    viewport: BROWSER_IDENTITY.viewport,
    userAgent: BROWSER_IDENTITY.userAgent,
    locale: BROWSER_IDENTITY.locale,
    timezoneId: BROWSER_IDENTITY.timezoneId,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  return {
    kind: "local",
    context,
    sessionId: null,
    debugUrl: null,
    close: async () => {
      await context.close().catch(() => {});
    },
  };
}

async function openSteelSession(options: BackendOptions): Promise<BrowserSession> {
  const baseURL = options.steelBaseUrl?.trim() || process.env.STEEL_BASE_URL?.trim() || undefined;

  /*
   * A self-hosted instance needs no key — DOMAIN/CDP_DOMAIN on the container
   * make it accept anything. Cloud always needs one.
   */
  const apiKey = options.steelApiKey?.trim() || process.env.STEEL_API_KEY || (baseURL ? "self-hosted" : undefined);
  if (!apiKey) {
    throw new Error(
      "A Steel API key is required: set app_settings.steel_api_key or STEEL_API_KEY",
    );
  }

  const client = new Steel({ steelAPIKey: apiKey, ...(baseURL ? { baseURL } : {}) });

  /*
   * Steel hands back a FRESH context every run — there is no profile directory
   * on disk to carry the login. Cookies are injected at session-create time via
   * sessionContext, which is cleaner than connecting first and calling
   * addCookies: the browser is already authenticated on its very first request,
   * so Instagram never sees a logged-out hit from this IP.
   */
  const cookies = parseSessionCookies(options.sessionCookie ?? process.env.INSTAGRAM_SESSION_COOKIE);

  const params: Steel.SessionCreateParams = {
    dimensions: BROWSER_IDENTITY.viewport,
    userAgent: BROWSER_IDENTITY.userAgent,
    timeout: options.sessionTimeoutMs ?? 180_000,
    blockAds: true,
    ...(cookies.length > 0 ? { sessionContext: { cookies } } : {}),
    /*
     * A custom proxyUrl pins the egress IP for this session. useProxy hands us
     * Steel's rotating pool instead. They are mutually exclusive in intent:
     * rotation is for logged-out work, pinning is for authenticated work.
     */
    ...(options.proxyUrl
      ? { proxyUrl: normalizeProxyUrl(options.proxyUrl) }
      : options.useRotatingProxy
        ? { useProxy: true }
        : {}),
    /*
     * The production shape: one persistent Steel profile per Instagram account,
     * so cookies and local storage survive between runs exactly as a real
     * browser profile would.
     */
    ...(options.profileId ? { profileId: options.profileId, persistProfile: true } : {}),
  };

  const session = await client.sessions.create(params);

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(
      baseURL ? session.websocketUrl : `${session.websocketUrl}&apiKey=${apiKey}`,
    );
  } catch (err) {
    // Never leave a paid session running because the connect failed.
    await client.sessions.release(session.id).catch(() => {});
    throw err;
  }

  // Steel returns a context with a page already open; do not create another.
  const context = browser.contexts()[0] ?? (await browser.newContext());

  return {
    kind: "steel",
    context,
    sessionId: session.id,
    debugUrl: session.sessionViewerUrl ?? session.debugUrl ?? null,
    /*
     * session.proxySource is Steel Cloud-only metadata — the self-hosted image
     * never returns it, so reading it here always reported "none (direct)"
     * against a self-hosted instance regardless of whether a proxy was used.
     * Verified 2026-08-03: a self-hosted session with proxyUrl set showed the
     * pinned Oxylabs exit IP to the target site, not this host's real IP — the
     * proxying works, only Cloud's extra reporting field is absent. Falling
     * back to what we ourselves configured keeps the log honest either way.
     */
    proxySource: session.proxySource ?? (options.proxyUrl ? "external" : options.useRotatingProxy ? "steel" : null),
    close: async () => {
      await browser.close().catch(() => {});
      // Releasing is what stops the billing clock; always attempt it.
      await client.sessions.release(session.id).catch(() => {});
    },
  };
}

/** Steel expects a scheme; a bare host:port is silently ignored. */
function normalizeProxyUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

/*
 * Converts the configured "name=value; name2=value2" cookie string into Steel's
 * cookie shape. Values are passed through to the API and never logged.
 */
function parseSessionCookies(raw: string | undefined): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}> {
  if (!raw || !raw.includes("=")) return [];
  return raw
    .split(";")
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) return null;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (!name || !value) return null;
      return { name, value, domain: ".instagram.com", path: "/", secure: true };
    })
    .filter((cookie): cookie is NonNullable<typeof cookie> => cookie !== null);
}
