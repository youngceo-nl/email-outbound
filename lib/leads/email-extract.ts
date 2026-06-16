// Pure email extraction — no I/O, no server-only deps so it stays easy to test.
// Shared by the IG-bio step and the YouTube-About step of the enrichment waterfall.
import * as cheerio from "cheerio";

// Standard-ish email matcher. Intentionally conservative on the local part to
// avoid swallowing trailing punctuation from prose.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

// Domains / fragments that are never a real contact address — analytics, CDNs,
// the platform's own infra, schema boilerplate, or image sprites like "logo@2x.png".
const NOISE_DOMAINS = [
  "youtube.com", "ytimg.com", "google.com", "googleapis.com", "googleusercontent.com",
  "gstatic.com", "schema.org", "w3.org", "sentry.io", "sentry-next.wixpress.com",
  "example.com", "example.org", "domain.com", "email.com", "wixpress.com",
  "facebook.com", "sentry.wixpress.com",
];
const NOISE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"];

// Well-known placeholder / demo addresses that appear in UI screenshots, docs, etc.
const PLACEHOLDER_ADDRESSES = new Set([
  "johnappleseed@gmail.com",
  "john@appleseed.com",
  "test@test.com",
  "test@example.com",
  "user@example.com",
  "email@example.com",
  "hello@example.com",
  "info@example.com",
]);

// Real TLDs are almost always ≤ 6 chars (.com, .io, .co.uk, .photography is 11 but rare).
// Anything longer than 13 chars is almost certainly a concatenated word like "comcopyright".
const MAX_TLD_LEN = 13;

function isPlausible(email: string): boolean {
  const lower = email.toLowerCase();

  if (NOISE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return false;
  if (PLACEHOLDER_ADDRESSES.has(lower)) return false;

  // Guard against version/sprite tokens like "icon@2x".
  if (/@\d+x$/.test(lower)) return false;

  const atIdx = lower.indexOf("@");
  const local = lower.slice(0, atIdx);
  const domain = lower.slice(atIdx + 1);

  // Local part starting with digits → almost always a phone-number prefix
  // concatenated with the real email (e.g. "385-506-2827sales@…").
  if (/^\d/.test(local)) return false;

  // Local part too long — real email handles are rarely > 40 chars.
  if (local.length > 40) return false;

  if (NOISE_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return false;

  // TLD (last label after the final dot) must not look like a concatenated word.
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (tld.length > MAX_TLD_LEN) return false;

  return true;
}

// Turn "name (at) domain (dot) com" / "name [at] domain dot com" into a real address.
function deobfuscate(text: string): string {
  return text
    .replace(/\s*[\(\[\{]\s*(?:at|AT)\s*[\)\]\}]\s*/g, "@")
    .replace(/\s+(?:at|AT)\s+/g, "@")
    .replace(/\s*[\(\[\{]\s*(?:dot|DOT)\s*[\)\]\}]\s*/g, ".")
    .replace(/\s+(?:dot|DOT)\s+/g, ".");
}

/** First plausible email found in free text, with light "(at)/(dot)" deobfuscation. */
export function extractEmailFromText(text: string | null | undefined): string | null {
  if (!text) return null;

  const direct = matchFirst(text);
  if (direct) return direct;

  // Deobfuscation ("name at domain dot com") is only safe on short human text —
  // on a full HTML doc the loose "at"/"dot" rewrite would manufacture false
  // positives. Restrict it to bio/description-sized strings.
  if (
    text.length <= 2000 &&
    /\b(?:at|AT)\b/.test(text) &&
    /\b(?:dot|DOT)\b/.test(text)
  ) {
    return matchFirst(deobfuscate(text));
  }
  return null;
}

function matchFirst(text: string): string | null {
  const matches = text.match(EMAIL_RE);
  if (!matches) return null;
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:]+$/, "");
    if (isPlausible(cleaned)) return cleaned.toLowerCase();
  }
  return null;
}

/**
 * Extract an email from an HTML document. Prefers explicit `mailto:` links
 * (highest confidence), then falls back to scanning the visible text. Used for
 * the YouTube channel About page, whose description/links carry any plaintext
 * address the creator chose to publish.
 */
export function extractEmailFromHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const $ = cheerio.load(html);

  // 1. mailto: hrefs
  let found: string | null = null;
  $('a[href^="mailto:"]').each((_, el) => {
    if (found) return;
    const href = $(el).attr("href") ?? "";
    const addr = decodeURIComponent(href.replace(/^mailto:/i, "").split("?")[0]).trim();
    const m = matchFirst(addr);
    if (m) found = m;
  });
  if (found) return found;

  // 2. Visible text fallback.
  return extractEmailFromText($("body").text() || $.text());
}
