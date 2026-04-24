import "server-only";
import { scrapingBeeGet, ScrapingBeeError } from "@/lib/scrapingbee/client";

export type LinkedInLookupResult = {
  url: string | null;
  candidates: string[];
  error: string | null;
};

export async function findLinkedInUrl(opts: {
  apiKey: string;
  fullName: string;
  hints?: string | null;
}): Promise<LinkedInLookupResult> {
  const tokens = nameTokens(opts.fullName);
  if (tokens.length < 2) {
    return { url: null, candidates: [], error: "skipped:single_word_name" };
  }

  const hint = (opts.hints ?? "").trim().slice(0, 80);
  const query = `"${opts.fullName.trim()}"${hint ? " " + hint : ""} site:linkedin.com/in`;
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

  const candidates = extractLinkedInUrls(html);
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

function extractLinkedInUrls(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/gi;
  for (const m of html.matchAll(re)) {
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
    const handle = extractHandle(url);
    if (!handle) continue;
    const handleNorm = handle.toLowerCase().replace(/-/g, " ");
    if (tokens.some((t) => handleNorm.includes(t))) return url;
  }
  return null;
}

function extractHandle(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}
