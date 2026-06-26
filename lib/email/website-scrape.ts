import "server-only";

const EMAIL_RE = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;

// Paths appended to the base domain when the root page has no email.
const SUBPATHS = ["/contact", "/about", "/contact-us", "/about-us"];

// These domains are navigated by other pipeline steps or are definitely not
// personal sites — skip them to avoid wasted fetches and false positives.
const SKIP_DOMAINS = [
  "youtube.com", "youtu.be",
  "linkedin.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com",
  "tiktok.com",
  "linktr.ee",
  "lnk.bio",
  "beacons.ai",
  "taplink.cc",
  "solo.to",
];

// Junk addresses to ignore even if found in HTML
const JUNK_RE = /noreply|no-reply|@sentry\.|@example\.|@cloudflare\.|\.png@|\.jpg@|\.gif@/i;

function extractEmails(html: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(html)) !== null) {
    const addr = m[1].toLowerCase();
    if (!JUNK_RE.test(addr)) found.add(addr);
  }
  return [...found];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; enrichment-bot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export type WebsiteScrapeResult =
  | { email: string; url: string }
  | { reason: string };

export async function scrapeEmailFromWebsite(rawUrl: string | null): Promise<WebsiteScrapeResult> {
  if (!rawUrl) return { reason: "no_url" };

  let normalised: string;
  try {
    normalised = new URL(rawUrl).href;
  } catch {
    return { reason: "invalid_url" };
  }

  const hostname = new URL(normalised).hostname.replace(/^www\./, "");
  if (SKIP_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
    return { reason: "skip_domain" };
  }

  // 1. Try the root URL first
  const rootHtml = await fetchText(normalised);
  if (rootHtml) {
    const emails = extractEmails(rootHtml);
    if (emails.length > 0) return { email: emails[0], url: normalised };
  }

  // 2. Try common contact/about subpaths using the base origin
  const origin = new URL(normalised).origin;
  for (const sub of SUBPATHS) {
    const subUrl = `${origin}${sub}`;
    const html = await fetchText(subUrl);
    if (!html) continue;
    const emails = extractEmails(html);
    if (emails.length > 0) return { email: emails[0], url: subUrl };
  }

  return { reason: "no_email" };
}
