import "server-only";
import { scrapingBeeGet, ScrapingBeeError } from "@/lib/scrapingbee/client";

export type YouTubeLookupResult = {
  url: string | null;
  candidates: string[];
  error: string | null;
};

/**
 * Find a person's / brand's YouTube channel by scraping a Google SERP through
 * ScrapingBee, mirroring `lib/linkedin/find.ts`. We never hit YouTube directly,
 * so there is no CAPTCHA / login wall — we only ever read public search results
 * and return the channel URL. Extracting the channel's gated business email is a
 * separate concern handled downstream by the enrichment layer.
 */
export async function findYouTubeChannel(opts: {
  apiKey: string;
  fullName: string;
  hints?: string | null;
}): Promise<YouTubeLookupResult> {
  const tokens = nameTokens(opts.fullName);
  if (tokens.length < 2) {
    return { url: null, candidates: [], error: "skipped:single_word_name" };
  }

  const hint = (opts.hints ?? "").trim().slice(0, 80);
  const query = `"${opts.fullName.trim()}"${hint ? " " + hint : ""} site:youtube.com`;
  const serpUrl = `https://www.google.com/search?hl=en&pws=0&q=${encodeURIComponent(query)}`;

  let html = "";
  try {
    const r = await scrapingBeeGet({
      apiKey: opts.apiKey,
      url: serpUrl,
      renderJs: false,
      premiumProxy: true,
      retries: 1,
    });
    html = r.body;
  } catch (err) {
    const msg = err instanceof ScrapingBeeError ? err.message : (err as Error).message;
    return { url: null, candidates: [], error: `serp_failed: ${msg.slice(0, 200)}` };
  }

  const candidates = extractChannelUrls(html);
  if (candidates.length === 0) {
    return { url: null, candidates: [], error: "no_serp_match" };
  }

  const matched = pickBestCandidate(candidates, tokens);
  if (!matched) {
    return { url: null, candidates, error: "no_name_overlap" };
  }
  return { url: matched, candidates, error: null };
}

function nameTokens(fullName: string): string[] {
  return fullName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[|·•@()\[\]{}.,'"]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

// Only the four canonical *channel* URL shapes. This naturally excludes video,
// shorts, playlist, results and other non-channel paths.
const CHANNEL_URL_RE =
  /https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@[A-Za-z0-9._-]+|channel\/UC[A-Za-z0-9_-]{22}|c\/[A-Za-z0-9._-]+|user\/[A-Za-z0-9._-]+)/gi;

function extractChannelUrls(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(CHANNEL_URL_RE)) {
    const raw = m[0].replace(/[)>"',]+$/, "");
    const cleaned = stripTracking(raw);
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
    if (out.length >= 10) break;
  }
  return out;
}

function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function pickBestCandidate(candidates: string[], tokens: string[]): string | null {
  for (const url of candidates) {
    const slug = extractSlug(url);
    if (!slug) continue; // opaque /channel/UC... ids carry no name signal
    const slugNorm = slug.toLowerCase().replace(/[-_.]/g, " ");
    if (tokens.some((t) => slugNorm.includes(t))) return url;
  }
  return null;
}

// Returns the name-bearing portion of a channel URL, or null for the opaque
// /channel/UC... form which we can't verify against a name.
function extractSlug(url: string): string | null {
  const m = url.match(/youtube\.com\/(?:@([A-Za-z0-9._-]+)|c\/([A-Za-z0-9._-]+)|user\/([A-Za-z0-9._-]+))/i);
  if (!m) return null;
  const raw = m[1] ?? m[2] ?? m[3] ?? null;
  return raw ? decodeURIComponent(raw) : null;
}
