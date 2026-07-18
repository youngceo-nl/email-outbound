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

function extractSellerNameFromHtml(html: string): string | null {
  // Whop is Next.js — try __NEXT_DATA__ first
  const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (ndMatch) {
    try {
      const str = JSON.stringify(JSON.parse(ndMatch[1]));
      const nameMatch = str.match(/"(?:sellerName|seller_name|companyName|company_name|creatorName|displayName|name)"\s*:\s*"([^"]{2,80})"/);
      if (nameMatch) return nameMatch[1];
    } catch {}
  }
  // og:title fallback
  const ogMatch = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (ogMatch) return ogMatch[1].split("|")[0].split("-")[0].trim() || null;
  return null;
}

export type WhopScrapeResult =
  | { instagram: string; sellerName: string | null; source: "page" }
  | { instagram: null; sellerName: string | null; source: "page" }
  | { error: string };

export async function scrapeWhopSeller(urlOrSlug: string): Promise<WhopScrapeResult> {
  // Accept either a full URL or just a slug
  let url: string;
  if (urlOrSlug.startsWith("http")) {
    url = urlOrSlug;
  } else {
    url = `https://whop.com/${urlOrSlug.replace(/^\//, "")}/`;
  }

  const page = await freeFetchPage(url, 10_000);
  if (!page) return { error: `fetch_failed:${url}` };

  const instagram = extractInstagramFromHtml(page.html);
  const sellerName = extractSellerNameFromHtml(page.html);
  return { instagram, sellerName, source: "page" };
}

// --- Marketplace discovery ---

export type WhopMarketplaceSeller = {
  name: string;
  slug: string;
  url: string;
  price?: string;
  description?: string;
};

const WHOP_CATEGORIES = [
  "business-and-money",
  "education",
  "trading",
  "ecommerce",
  "personal-development",
] as const;

export type WhopCategory = typeof WHOP_CATEGORIES[number];

export async function scrapeWhopMarketplace(
  category: WhopCategory = "business-and-money",
  page = 1,
): Promise<{ sellers: WhopMarketplaceSeller[] } | { error: string }> {
  const url = `https://whop.com/marketplace/?category=${category}&page=${page}`;
  const result = await freeFetchPage(url, 12_000);
  if (!result) return { error: "fetch_failed" };

  const sellers: WhopMarketplaceSeller[] = [];
  const { html } = result;

  // Try __NEXT_DATA__ for structured product listings
  const ndMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (ndMatch) {
    try {
      const data = JSON.parse(ndMatch[1]);
      const str = JSON.stringify(data);
      // Extract all slug+name pairs we can find
      const slugMatches = [...str.matchAll(/"(?:route|slug|path)"\s*:\s*"\/([a-z0-9-]+)"/g)];
      const nameMatches = [...str.matchAll(/"(?:title|name)"\s*:\s*"([^"]{3,80})"/g)];
      // Pair them up (best effort)
      const seen = new Set<string>();
      for (let i = 0; i < slugMatches.length; i++) {
        const slug = slugMatches[i][1];
        if (seen.has(slug) || slug === category) continue;
        seen.add(slug);
        const name = nameMatches[i]?.[1] ?? slug;
        sellers.push({ name, slug, url: `https://whop.com/${slug}/` });
      }
    } catch {}
  }

  // Fallback: regex over raw HTML for href="/slug" patterns
  if (sellers.length === 0) {
    const hrefMatches = [...html.matchAll(/href="\/([a-z0-9][a-z0-9-]{2,40})\/"/g)];
    const seen = new Set<string>();
    for (const m of hrefMatches) {
      const slug = m[1];
      if (seen.has(slug) || ["marketplace", "login", "signup", "explore"].includes(slug)) continue;
      seen.add(slug);
      sellers.push({ name: slug, slug, url: `https://whop.com/${slug}/` });
    }
  }

  return { sellers };
}
