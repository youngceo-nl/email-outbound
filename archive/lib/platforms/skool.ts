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

// Skool's __NEXT_DATA__ payload embeds the group owner's `link_instagram`
// field, but it sometimes sits inside an already-JSON-escaped nested string
// blob rather than as a plain top-level key. A JSON.parse/stringify roundtrip
// mangles that escaping, so we regex the raw script text directly — `\\?"`
// tolerates both the plain and pre-escaped quote forms.
function extractOwnerInstagramFromNextData(raw: string): string | null {
  const m = raw.match(/link_instagram\\?":\\?"([^"\\]*)/);
  if (!m || !m[1]) return null;
  const um = m[1].match(/instagram\.com\/([a-zA-Z0-9_.]{1,30})/);
  return um ? um[1].toLowerCase() : null;
}

function extractOwnerNameFromNextData(raw: string): string | null {
  const first = raw.match(/first_name\\?":\\?"([^"\\]+)/);
  const last = raw.match(/last_name\\?":\\?"([^"\\]+)/);
  if (first && last) return `${first[1]} ${last[1]}`.trim();
  const m = raw.match(/(?:ownerName|creatorName|fullName|displayName|owner_name)\\?":\\?"([^"\\]{2,50})/);
  return m ? m[1] : null;
}

function extractCommunityStats(raw: string): { totalMembers: number | null; numCourses: number | null } {
  const members = raw.match(/totalMembers\\?":\s*(\d+)/);
  const courses = raw.match(/numCourses\\?":\s*(\d+)/);
  return {
    totalMembers: members ? parseInt(members[1], 10) : null,
    numCourses: courses ? parseInt(courses[1], 10) : null,
  };
}

function extractOwnerNameFromHtml(html: string): string | null {
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
  | { instagram: string | null; ownerName: string | null; totalMembers: number | null; numCourses: number | null; source: "page" }
  | { error: string };

export async function scrapeSkoolCommunity(slug: string): Promise<SkoolScrapeResult> {
  const url = `https://www.skool.com/${slug}/about`;
  const page = await freeFetchPage(url, 10_000);
  if (!page) return { error: `fetch_failed:${slug}` };

  const ndMatch = page.html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  const raw = ndMatch?.[1] ?? "";

  const instagram = (raw && extractOwnerInstagramFromNextData(raw)) || extractInstagramFromHtml(page.html);
  const ownerName = (raw && extractOwnerNameFromNextData(raw)) || extractOwnerNameFromHtml(page.html);
  const { totalMembers, numCourses } = raw ? extractCommunityStats(raw) : { totalMembers: null, numCourses: null };

  return { instagram, ownerName, totalMembers, numCourses, source: "page" };
}
