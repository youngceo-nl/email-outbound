import "server-only";
import { freeFetchPage } from "@/lib/funnel/free-fetch";

const IG_LINK_RE = /instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?(?:\?[^"'\s]*)?["'\s]/g;
const IG_RESERVED = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "accounts",
  "about", "help", "legal", "privacy", "safety", "press", "direct",
  "directory", "login", "challenge", "oauth", "api",
]);

function extractInstagramFromHtml(html: string): string | null {
  IG_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IG_LINK_RE.exec(html)) !== null) {
    const username = m[1].toLowerCase();
    if (!IG_RESERVED.has(username)) return username;
  }
  return null;
}

function extractOwnerNameFromHtml(html: string): string | null {
  // Try __NEXT_DATA__ JSON first — Skool is a Next.js app
  const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (ndMatch) {
    try {
      const data = JSON.parse(ndMatch[1]);
      const str = JSON.stringify(data);
      // Look for "ownerName", "creatorName", "fullName", "displayName" keys
      const nameMatch = str.match(/"(?:ownerName|creatorName|fullName|displayName|owner_name)"\s*:\s*"([^"]{2,50})"/);
      if (nameMatch) return nameMatch[1];
    } catch {}
  }

  // Fallback: og:title or twitter:title often includes owner name
  const ogMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    ?? html.match(/<meta[^>]+name="twitter:title"[^>]+content="([^"]+)"/i);
  if (ogMatch) {
    // og:title for Skool is usually "Community Name by Owner Name"
    const byMatch = ogMatch[1].match(/\bby\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})\b/i);
    if (byMatch) return byMatch[1];
  }

  return null;
}

export type SkoolScrapeResult =
  | { instagram: string; ownerName: string | null; source: "page" }
  | { instagram: null; ownerName: string | null; source: "page" }
  | { error: string };

export async function scrapeSkoolCommunity(slug: string): Promise<SkoolScrapeResult> {
  const url = `https://www.skool.com/${slug}/about`;
  const page = await freeFetchPage(url, 10_000);
  if (!page) return { error: `fetch_failed:${slug}` };

  const instagram = extractInstagramFromHtml(page.html);
  const ownerName = extractOwnerNameFromHtml(page.html);
  return { instagram, ownerName, source: "page" };
}
