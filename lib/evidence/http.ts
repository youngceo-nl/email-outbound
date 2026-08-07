/*
 * Network primitives for evidence acquisition.
 *
 * A deliberate duplicate of lib/funnel/free-fetch.ts minus the `server-only`
 * import, so the acquisition layer stays runnable under `tsx` for tests,
 * fixtures, and the qualification CLI. Acquisition is read-only: nothing here
 * submits forms, authenticates, or bypasses access controls.
 */

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
  method: "free_fetch";
  /** Optional so existing test fixtures built before this field existed still typecheck. */
  status?: number | null;
};

export type PageFetchFailure = {
  kind: "http_error" | "timeout" | "non_html" | "network" | "auth_required" | "unsupported";
  detail: string;
  /*
   * The raw HTTP status, when one was actually received. "coaches whose paid
   * offer is no longer active" needs to tell a dead 404/410 landing page apart
   * from a page we simply could not reach — `detail` alone buried that as an
   * unparsed string. Optional so existing test fixtures still typecheck.
   */
  status?: number | null;
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
      return { ok: false, failure: { kind: "auth_required", detail: `HTTP ${res.status}`, status: res.status } };
    }
    if (!res.ok) {
      return { ok: false, failure: { kind: "http_error", detail: `HTTP ${res.status}`, status: res.status } };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return { ok: false, failure: { kind: "non_html", detail: contentType || "unknown", status: res.status } };
    }
    const html = await res.text();
    return {
      ok: true,
      page: {
        html,
        finalUrl: res.url || url,
        redirectChain: res.url && res.url !== url ? [url, res.url] : [url],
        method: "free_fetch",
        status: res.status,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const kind = /abort|timeout/i.test(detail) ? "timeout" : "network";
    return { ok: false, failure: { kind, detail, status: null } };
  }
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

export type AcquirePage = (url: string) => Promise<PageFetchOutcome>;

/*
 * Plain HTTP is the only acquisition path. A page whose commercial content is
 * behind JavaScript comes back as an unusable-but-successful outcome — the
 * caller records it and moves on rather than treating it as a fetch failure,
 * because "we read the page and it had no offer" is a finding, not an error.
 *
 * There is deliberately no rendering fallback here. Steel + Playwright is the
 * intended one (it already serves Instagram acquisition, see
 * lib/instagram/steel-acquisition.ts) but is not wired into this collector yet.
 */
export function createAcquirePage(): AcquirePage {
  return (url: string) => freeFetchPage(url);
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
