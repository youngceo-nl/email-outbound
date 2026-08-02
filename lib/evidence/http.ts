/*
 * Network primitives for evidence acquisition.
 *
 * A deliberate duplicate of lib/scrapingbee/client.ts and lib/funnel/free-fetch.ts
 * minus the `server-only` import, so the acquisition layer stays runnable under
 * `tsx` for tests, fixtures, and the qualification CLI. Acquisition is read-only:
 * nothing here submits forms, authenticates, or bypasses access controls.
 */

const SB_BASE = "https://app.scrapingbee.com/api/v1/";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export type FetchedPage = {
  html: string;
  finalUrl: string;
  redirectChain: string[];
  method: "free_fetch" | "scrapingbee";
};

export type PageFetchFailure = {
  kind: "http_error" | "timeout" | "non_html" | "network" | "auth_required" | "unsupported";
  detail: string;
};

export type PageFetchOutcome =
  | { ok: true; page: FetchedPage }
  | { ok: false; failure: PageFetchFailure };

export async function freeFetchPage(url: string, timeoutMs = 12_000): Promise<PageFetchOutcome> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: BROWSER_HEADERS,
      redirect: "follow",
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, failure: { kind: "auth_required", detail: `HTTP ${res.status}` } };
    }
    if (!res.ok) {
      return { ok: false, failure: { kind: "http_error", detail: `HTTP ${res.status}` } };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return { ok: false, failure: { kind: "non_html", detail: contentType || "unknown" } };
    }
    const html = await res.text();
    return {
      ok: true,
      page: {
        html,
        finalUrl: res.url || url,
        redirectChain: res.url && res.url !== url ? [url, res.url] : [url],
        method: "free_fetch",
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const kind = /abort|timeout/i.test(detail) ? "timeout" : "network";
    return { ok: false, failure: { kind, detail } };
  }
}

export async function scrapingBeeGet(opts: {
  apiKey: string;
  url: string;
  renderJs?: boolean;
  premiumProxy?: boolean;
  forwardHeaders?: Record<string, string>;
  retries?: number;
}): Promise<{ status: number; body: string }> {
  const params = new URLSearchParams({
    api_key: opts.apiKey,
    url: opts.url,
    render_js: opts.renderJs ? "true" : "false",
    premium_proxy: opts.premiumProxy ? "true" : "false",
    block_resources: "true",
  });
  if (opts.forwardHeaders) params.set("forward_headers", "true");

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.forwardHeaders ?? {})) {
    headers[`Spb-${key}`] = value;
  }

  const retries = opts.retries ?? 2;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${SB_BASE}?${params.toString()}`, {
        headers,
        signal: AbortSignal.timeout(45_000),
      });
      const body = await res.text();
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new Error(`ScrapingBee ${res.status}: ${body.slice(0, 200)}`);
      }
      return { status: res.status, body };
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("ScrapingBee call failed");
}

export async function scrapingBeeFetchPage(opts: {
  apiKey: string;
  url: string;
  renderJs?: boolean;
}): Promise<PageFetchOutcome> {
  try {
    const { body } = await scrapingBeeGet({
      apiKey: opts.apiKey,
      url: opts.url,
      renderJs: opts.renderJs ?? true,
      premiumProxy: false,
    });
    return {
      ok: true,
      page: { html: body, finalUrl: opts.url, redirectChain: [opts.url], method: "scrapingbee" },
    };
  } catch (err) {
    return {
      ok: false,
      failure: { kind: "network", detail: err instanceof Error ? err.message : String(err) },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Acquisition with controlled fallback
// ---------------------------------------------------------------------------

export const MINIMUM_HTML_LENGTH = 500;

/*
 * A shell that ships no readable copy means the commercial content is behind
 * JavaScript. Detected by stripping tags and measuring what a reader would see,
 * not by looking for framework names — plenty of SSR'd Next.js pages are
 * perfectly readable.
 */
export function looksLikeJavascriptShell(html: string): boolean {
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return visible.length < 400;
}

/*
 * Structural markers that never appear on a page innocently — safe to match
 * against raw HTML.
 */
const CHALLENGE_MARKERS = /(cf-browser-verification|__cf_chl)/i;

/*
 * Phrases a blocked human would actually SEE. These must be matched against
 * visible text only, never raw HTML: a page that merely loads reCAPTCHA ships
 * `<script src=".../recaptcha/enterprise.js">`, and "recaptcha" contains
 * "captcha". Matching raw HTML discarded every stan.store / checkout / lead-form
 * page as a bot challenge — the single largest source of missing funnel
 * evidence in the 2026-08-02 test run, where readable 1,716-character pages were
 * thrown away and their leads scored "information_funnel unknown".
 */
const CHALLENGE_PHRASES =
  /(just a moment|checking your browser|enable javascript and cookies|are you a robot|access denied|verify you are human|please complete the captcha)/i;

export function containsBotChallenge(html: string): boolean {
  if (CHALLENGE_MARKERS.test(html.slice(0, 4000))) return true;
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return CHALLENGE_PHRASES.test(visible.slice(0, 4000));
}

export function pageIsUsable(page: FetchedPage): boolean {
  if (page.html.length < MINIMUM_HTML_LENGTH) return false;
  if (containsBotChallenge(page.html)) return false;
  if (looksLikeJavascriptShell(page.html)) return false;
  return true;
}

/*
 * ScrapingBee costs credits, so it runs only when the free fetch demonstrably
 * failed to deliver readable HTML. It must NEVER be used merely because the page
 * contained no coaching offer — "we read the page and it had no offer" is a
 * finding, not an acquisition failure, and paying to re-read it changes nothing.
 */
export function shouldUseScrapingBee(outcome: PageFetchOutcome): boolean {
  if (!outcome.ok) {
    // A hard 404 is a real answer; a block or transport failure is not.
    return outcome.failure.kind !== "http_error" || /40[34]|429|5\d\d/.test(outcome.failure.detail);
  }
  return !pageIsUsable(outcome.page);
}

export type AcquirePage = (url: string) => Promise<PageFetchOutcome>;

/** Free HTTP first, ScrapingBee only on demonstrable acquisition failure, capped. */
export function createAcquirePage(config: {
  scrapingBeeApiKey: string | null;
  maxScrapingBeeCalls?: number;
}): AcquirePage {
  let scrapingBeeCallsUsed = 0;
  const budget = config.maxScrapingBeeCalls ?? 2;

  return async (url: string) => {
    const free = await freeFetchPage(url);
    if (free.ok && pageIsUsable(free.page)) return free;

    if (!config.scrapingBeeApiKey) return free;
    if (!shouldUseScrapingBee(free)) return free;
    if (scrapingBeeCallsUsed >= budget) return free;

    scrapingBeeCallsUsed += 1;
    const rendered = await scrapingBeeFetchPage({
      apiKey: config.scrapingBeeApiKey,
      url,
      renderJs: true,
    });
    // Falling back to the free result keeps whatever partial evidence we had
    // rather than discarding it because the paid attempt also failed.
    return rendered.ok && pageIsUsable(rendered.page) ? rendered : free;
  };
}

export function canonicalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    // Tracking parameters make identical destinations look distinct, which
    // defeats cycle detection and wastes the hop budget on the same page.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igshid|mc_|ref_?$|_ga)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
