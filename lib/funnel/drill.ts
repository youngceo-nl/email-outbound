import "server-only";
import * as cheerio from "cheerio";

const NOISE_HOSTS = [
  "instagram.com", "facebook.com", "twitter.com", "x.com", "tiktok.com",
  "youtube.com", "youtu.be", "linkedin.com", "pinterest.com", "snapchat.com",
  "threads.net", "spotify.com", "open.spotify.com", "apple.com",
  "podcasts.apple.com", "music.apple.com", "amazon.com", "amzn.to",
  "linktr.ee", "stan.store", "beacons.ai", "beacons.page", "bio.link",
  "lnk.bio", "linkin.bio", "snipfeed.co", "tap.bio", "campsite.bio",
  "later.com", "msha.ke",
];

// Strong signals for the "free course / VSL / opt-in" link a creator wants you
// to click first. The user explicitly asked for these to be picked.
const VSL_KEYWORDS_TEXT = [
  "free training", "free masterclass", "free course", "free workshop",
  "free webinar", "free guide", "free lesson", "free video",
  "watch the training", "watch the masterclass", "watch the video",
  "vsl", "video sales letter",
  "training", "masterclass", "workshop", "webinar",
  "case study", "blueprint", "framework", "method", "system",
  "secrets", "lesson", "tutorial", "optin", "opt-in", "opt in",
  "get access", "get instant access", "get started",
];

const VSL_KEYWORDS_PATH = [
  "/training", "/masterclass", "/webinar", "/workshop", "/free",
  "/vsl", "/video", "/optin", "/opt-in", "/access", "/watch",
  "/course", "/lesson", "/case-study", "/blueprint",
];

const PURCHASE_KEYWORDS = ["buy", "purchase", "checkout", "cart", "shop", "store", "products"];

type Candidate = {
  href: string;
  text: string;
  score: number;
  reasons: string[];
};

export function pickBestFunnelLink(opts: {
  aggregatorUrl: string;
  html: string;
}): string | null {
  const $ = cheerio.load(opts.html);
  const host = parseHost(opts.aggregatorUrl);
  const seen = new Map<string, Candidate>();

  $("a[href]").each((_, el) => {
    const $a = $(el);
    const rawHref = ($a.attr("href") || "").trim();
    if (!rawHref) return;

    const href = absolutize(rawHref, opts.aggregatorUrl);
    if (!href) return;
    const linkHost = parseHost(href);
    if (!linkHost || linkHost === host) return;
    if (NOISE_HOSTS.some((n) => linkHost === n || linkHost.endsWith(`.${n}`))) return;
    if (!/^https?:/i.test(href)) return;

    const text = ($a.text() || "").trim().replace(/\s+/g, " ");
    const ariaLabel = ($a.attr("aria-label") || "").trim();
    const visible = (text || ariaLabel).toLowerCase();

    let score = 0;
    const reasons: string[] = [];

    const lowerHref = href.toLowerCase();
    if (VSL_KEYWORDS_PATH.some((k) => lowerHref.includes(k))) {
      score += 4;
      reasons.push("path:vsl-kw");
    }
    if (visible.includes("free")) {
      score += 4;
      reasons.push("text:free");
    }
    for (const kw of VSL_KEYWORDS_TEXT) {
      if (visible.includes(kw)) {
        score += kw.startsWith("free ") ? 5 : 3;
        reasons.push(`text:${kw}`);
        break;
      }
    }

    if (PURCHASE_KEYWORDS.some((k) => visible.includes(k))) {
      score -= 3;
      reasons.push("text:purchase-penalty");
    }

    if (text.length >= 3 && text.length <= 60) {
      score += 1;
      reasons.push("text:length-ok");
    }

    const cls = ($a.attr("class") || "").toLowerCase();
    if (/(button|cta|primary|hero|main)/.test(cls)) {
      score += 1;
      reasons.push("class:cta");
    }

    const existing = seen.get(href);
    if (existing) {
      existing.score += 1;
      existing.reasons.push("repeat");
    } else {
      seen.set(href, { href, text, score, reasons });
    }
  });

  // Position bonus: first 25% of <a> elements get +2
  const allHrefs = $("a[href]").toArray();
  const cutoff = Math.max(1, Math.floor(allHrefs.length * 0.25));
  for (let i = 0; i < cutoff; i++) {
    const href = absolutize($(allHrefs[i]).attr("href") || "", opts.aggregatorUrl);
    if (href && seen.has(href)) {
      const c = seen.get(href)!;
      c.score += 2;
      c.reasons.push("position:top");
    }
  }

  const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  if (ranked[0].score <= 0) return null;
  return ranked[0].href;
}

function parseHost(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function absolutize(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
