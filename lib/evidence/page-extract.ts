/*
 * Deterministic commercial page extraction.
 *
 * Returns what a page *says*, never what it means for the lead. Classification
 * here is a seed for the AI extractor and the deterministic gate; it does not
 * decide eligibility. Navigation, legal boilerplate, and footers are excluded
 * from offer copy unless they resolve a business-model fact.
 */

import * as cheerio from "cheerio";
import type { DestinationType, ExtractedCta, VisitorOutcome } from "@/lib/qualification/types";
import { canonicalizeUrl, hostOf } from "./http";

export type PageExtraction = {
  canonical_url: string | null;
  page_title: string | null;
  meta_description: string | null;
  headings: string[];
  cta_labels: ExtractedCta[];
  offer_copy: string[];
  prices: string[];
  outbound_links: Array<{ url: string; label: string }>;
  text_excerpt: string;
  destination_type: DestinationType;
  visitor_receives: VisitorOutcome[];
  classification_reason: string;
};

const MAX_EXCERPT = 6000;
const MAX_HEADINGS = 25;
const MAX_CTAS = 30;
const MAX_OUTBOUND = 60;

// ---------------------------------------------------------------------------
// Host and path vocabularies
// ---------------------------------------------------------------------------

export const LINK_HUB_HOSTS = [
  "linktr.ee", "beacons.ai", "beacons.page", "stan.store", "bio.link", "link.me",
  "direct.me", "linktw.in", "komi.io", "taplink.cc", "milkshake.app", "campsite.bio",
  "snipfeed.co", "msha.ke", "lnk.bio", "linkin.bio", "flowcode.com", "withkoji.com",
  "solo.to", "carrd.co", "hoo.be", "shorby.com", "allmylinks.com", "linkpop.com",
];

const BOOKING_HOSTS = [
  "calendly.com", "cal.com", "savvycal.com", "acuityscheduling.com", "tidycal.com",
  "oncehub.com", "scheduleonce.com", "meetings.hubspot.com", "youcanbook.me",
  "appointlet.com", "setmore.com", "zcal.co", "hey.calendar",
];

const FORM_HOSTS = [
  "typeform.com", "jotform.com", "docs.google.com", "forms.gle", "airtable.com",
  "tally.so", "fillout.com", "formstack.com", "gohighlevel.com", "surveymonkey.com",
];

const COMMUNITY_HOSTS = [
  "skool.com", "whop.com", "discord.gg", "discord.com", "circle.so", "mn.co",
  "mighty.co", "patreon.com", "heartbeat.chat", "slack.com",
];

const STORE_HOSTS = [
  "shopify.com", "myshopify.com", "etsy.com", "amazon.com", "amzn.to",
  "bigcartel.com", "squarespace-cdn.com", "stanstore.com",
];

const COURSE_HOSTS = [
  "teachable.com", "thinkific.com", "kajabi.com", "mykajabi.com", "podia.com",
  "gumroad.com", "circle.so", "learnworlds.com", "clickfunnels.com", "samcart.com",
  "systeme.io", "go.hotmart.com", "coachesconsole.com",
];

const SOCIAL_HOSTS = [
  "instagram.com", "facebook.com", "twitter.com", "x.com", "tiktok.com",
  "linkedin.com", "pinterest.com", "snapchat.com", "threads.net", "reddit.com",
  "open.spotify.com", "spotify.com", "podcasts.apple.com", "music.apple.com",
  "wa.me", "t.me", "telegram.me",
];

const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"];

const APPLICATION_PATHS = ["/apply", "/application", "/applications", "/qualify", "/intake"];
const BOOKING_PATHS = ["/book", "/booking", "/call", "/schedule", "/strategy-call", "/discovery"];
const LEAD_MAGNET_PATHS = [
  "/free", "/training", "/webinar", "/masterclass", "/workshop", "/blueprint",
  "/roadmap", "/guide", "/download", "/optin", "/opt-in", "/vsl", "/watch", "/checklist",
];
const EDUCATION_PATHS = [
  "/course", "/courses", "/program", "/programs", "/coaching", "/academy",
  "/mentorship", "/mastermind", "/school", "/university", "/learn", "/join",
  "/membership", "/accelerator", "/bootcamp", "/challenge",
];
const STORE_PATHS = ["/shop", "/store", "/product", "/products", "/cart", "/collections", "/checkout"];

// ---------------------------------------------------------------------------
// Content vocabularies
// ---------------------------------------------------------------------------

/*
 * The done-for-you bundle from spec Chapter 4. Kept as three independent
 * component lists because the gate requires corroboration across components,
 * not a single unlucky word. The bare word "agency" is deliberately absent —
 * the spec states it is never sufficient on its own.
 */
export const SERVICE_DELIVERY_PATTERNS = [
  /\bdone[- ]for[- ]you\b/i, /\bDFY\b/, /\bfull[- ]stack (service|agency)\b/i,
  /\bfunnel (implementation|build(ing)?)\b/i, /\blead gen(eration)? (service|agency)\b/i,
  /\bappointment setting\b/i, /\bmedia buying\b/i, /\bcontent production\b/i,
  /\bsales operations\b/i, /\bmanaged (marketing|ads|advertising)\b/i,
  /\bwe (handle|run|manage) (your|the) (ads|marketing|funnel|content|outreach)\b/i,
  /\bghostwriting service\b/i, /\bwe do it (all )?for you\b/i,
];

export const TEAM_PERFORMANCE_PATTERNS = [
  /\bwe (install|implement|manage|build|handle|create|run|execute)\b/i,
  /\bwe build (it )?for you\b/i, /\bour team\b/i, /\bhire us\b/i, /\bhire our\b/i,
  /\blet us (handle|manage|run|build)\b/i, /\bour (agency|clients|process|system) delivers\b/i,
  /\bwe'll (do|build|handle|manage|run)\b/i,
];

export const SERVICE_CTA_PATTERNS = [
  /\bbook a call with (our|the) team\b/i, /\baudit (your|my) funnel\b/i,
  /\bbecome a partner\b/i, /\bapply to work with us\b/i, /\bwork with (us|our team)\b/i,
  /\brequest a (service )?(quote|proposal|consultation)\b/i, /\bget a free audit\b/i,
];

const EDUCATION_CONTENT_PATTERNS = [
  /\b1[:-]?1 coaching\b/i, /\bprivate coaching\b/i, /\bgroup coaching\b/i,
  /\bmentorship\b/i, /\bmastermind\b/i, /\bcohort\b/i, /\bcurriculum\b/i,
  /\b(free )?(course|training|masterclass|webinar|workshop|bootcamp)\b/i,
  /\bblueprint\b/i, /\broadmap\b/i, /\bplaybook\b/i, /\bacademy\b/i,
  /\blearn (how|to|from)\b/i, /\bmodules?\b/i, /\blessons?\b/i,
  /\bstudents?\b/i, /\bcoaching program\b/i, /\bteach you\b/i,
];

const CTA_TEXT_PATTERNS = [
  /\bapply\b/i, /\bbook\b/i, /\bschedule\b/i, /\bjoin\b/i, /\benroll\b/i,
  /\bregister\b/i, /\bget (started|access|instant access|the|my)\b/i,
  /\bdownload\b/i, /\bclaim\b/i, /\bwatch\b/i, /\bstart\b/i, /\bsubscribe\b/i,
  /\bwork with me\b/i, /\bwork with us\b/i, /\bcontact\b/i, /\bbuy\b/i,
  /\blearn more\b/i, /\bsign up\b/i, /\brequest\b/i, /\bdm\b/i,
];

const PRICE_PATTERN =
  /[$€£]\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s?k\b)?(?:\s?\/\s?(?:mo|month|yr|year|wk|week)\b|\s?per\s+(?:month|year|week)\b)?/gi;

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export function extractPage(opts: { html: string; url: string }): PageExtraction {
  const $ = cheerio.load(opts.html);

  const canonical =
    $('link[rel="canonical"]').attr("href")?.trim() ||
    $('meta[property="og:url"]').attr("content")?.trim() ||
    null;

  const pageTitle =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").first().text().trim() ||
    null;

  const metaDescription =
    $('meta[property="og:description"]').attr("content")?.trim() ||
    $('meta[name="description"]').attr("content")?.trim() ||
    null;

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    if (headings.length >= MAX_HEADINGS) return;
    const text = clean($(el).text());
    if (text.length >= 3 && text.length <= 220) headings.push(text);
  });

  const outbound: Array<{ url: string; label: string }> = [];
  const ctaLabels: ExtractedCta[] = [];
  const seenLinks = new Set<string>();

  $("a[href]").each((_, el) => {
    const $a = $(el);
    const rawHref = ($a.attr("href") ?? "").trim();
    if (!rawHref || rawHref.startsWith("#")) return;
    const absolute = absolutize(rawHref, opts.url);
    if (!absolute) return;
    const label = clean($a.text()) || clean($a.attr("aria-label") ?? "") || "";

    if (!seenLinks.has(absolute) && outbound.length < MAX_OUTBOUND) {
      seenLinks.add(absolute);
      outbound.push({ url: absolute, label });
    }
    if (
      label &&
      label.length <= 80 &&
      ctaLabels.length < MAX_CTAS &&
      CTA_TEXT_PATTERNS.some((pattern) => pattern.test(label))
    ) {
      ctaLabels.push({ label, url: absolute });
    }
  });

  // Buttons that submit rather than link still express intent.
  $("button, input[type=submit], [role=button]").each((_, el) => {
    if (ctaLabels.length >= MAX_CTAS) return;
    const label = clean($(el).text()) || clean($(el).attr("value") ?? "");
    if (label && label.length <= 80 && CTA_TEXT_PATTERNS.some((p) => p.test(label))) {
      ctaLabels.push({ label, url: null });
    }
  });

  // Offer copy is read before boilerplate is stripped for the excerpt, but nav,
  // footer, and legal blocks are excluded so a cookie banner never reads as an offer.
  const offerCopy = collectOfferCopy($);

  const bodyText = extractBodyText($);
  const prices = [...new Set([...bodyText.matchAll(PRICE_PATTERN)].map((m) => m[0].trim()))].slice(0, 12);

  const classification = classifyDestination({
    url: opts.url,
    canonicalUrl: canonical,
    title: pageTitle,
    metaDescription,
    headings,
    offerCopy,
    ctaLabels,
    bodyText,
  });

  return {
    canonical_url: canonical ? canonicalizeUrl(canonical) : null,
    page_title: pageTitle,
    meta_description: metaDescription,
    headings,
    cta_labels: dedupeCtas(ctaLabels),
    offer_copy: offerCopy,
    prices,
    outbound_links: outbound,
    text_excerpt: bodyText.slice(0, MAX_EXCERPT),
    destination_type: classification.type,
    visitor_receives: classification.visitorReceives,
    classification_reason: classification.reason,
  };
}

function collectOfferCopy($: cheerio.CheerioAPI): string[] {
  const scoped = $.root().clone();
  scoped.find("script, style, noscript, svg, nav, footer, header, [class*='cookie'], [class*='legal']").remove();

  const out: string[] = [];
  scoped.find("p, li, blockquote").each((_, el) => {
    if (out.length >= 40) return;
    const text = clean($(el).text());
    if (text.length < 25 || text.length > 400) return;
    if (/^(privacy|terms|cookie|copyright|©|all rights reserved)/i.test(text)) return;
    out.push(text);
  });
  return out;
}

function extractBodyText($: cheerio.CheerioAPI): string {
  const scoped = $.root().clone();
  scoped.find("script, style, noscript, svg").remove();
  return clean(scoped.find("body").text() || scoped.text());
}

// ---------------------------------------------------------------------------
// Destination classification
// ---------------------------------------------------------------------------

export function classifyDestination(opts: {
  url: string;
  canonicalUrl?: string | null;
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  offerCopy: string[];
  ctaLabels: ExtractedCta[];
  bodyText: string;
}): { type: DestinationType; visitorReceives: VisitorOutcome[]; reason: string } {
  const host = hostOf(opts.url) ?? "";
  const path = pathOf(opts.url).toLowerCase();
  const matchesHost = (list: string[]) =>
    list.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));

  // --- Host-level classification is the most reliable signal available. ---
  if (matchesHost(YOUTUBE_HOSTS)) {
    return { type: "youtube", visitorReceives: ["education"], reason: "youtube host" };
  }
  if (matchesHost(LINK_HUB_HOSTS)) {
    return { type: "link_hub", visitorReceives: ["unknown"], reason: "link hub host" };
  }
  if (matchesHost(BOOKING_HOSTS)) {
    return { type: "booking", visitorReceives: ["coaching"], reason: "booking platform host" };
  }
  if (matchesHost(COMMUNITY_HOSTS)) {
    return { type: "community", visitorReceives: ["community"], reason: "community platform host" };
  }
  if (matchesHost(FORM_HOSTS)) {
    return { type: "application", visitorReceives: ["unknown"], reason: "form platform host" };
  }
  if (matchesHost(STORE_HOSTS)) {
    return { type: "store", visitorReceives: ["commerce_product"], reason: "store platform host" };
  }
  if (matchesHost(COURSE_HOSTS)) {
    return {
      type: "education",
      visitorReceives: ["information_product", "education"],
      reason: "course platform host",
    };
  }

  // --- Content evidence: the agency bundle outranks a generic path. ---
  const haystack = [
    opts.title ?? "",
    opts.metaDescription ?? "",
    ...opts.headings,
    ...opts.offerCopy,
    ...opts.ctaLabels.map((cta) => cta.label),
  ].join(" \n ");
  const fullText = `${haystack}\n${opts.bodyText.slice(0, 12000)}`;

  const serviceDelivery = countMatches(fullText, SERVICE_DELIVERY_PATTERNS);
  const teamPerformance = countMatches(fullText, TEAM_PERFORMANCE_PATTERNS);
  const serviceCta = countMatches(fullText, SERVICE_CTA_PATTERNS);
  const educationHits = countMatches(fullText, EDUCATION_CONTENT_PATTERNS);

  const agencyComponents = [serviceDelivery, teamPerformance, serviceCta].filter((n) => n > 0).length;
  // Two corroborating components with explicit done-for-you delivery language,
  // per the spec's reliability rule. A single component is never enough.
  if (agencyComponents >= 2 && serviceDelivery > 0) {
    return {
      type: "agency_service",
      visitorReceives: ["done_for_you_service"],
      reason: `agency bundle: delivery=${serviceDelivery} team=${teamPerformance} cta=${serviceCta}`,
    };
  }

  // --- Path-level classification ---
  const pathHit = (paths: string[]) => paths.find((candidate) => path.includes(candidate));

  const applicationPath = pathHit(APPLICATION_PATHS);
  if (applicationPath) {
    return { type: "application", visitorReceives: ["unknown"], reason: `path ${applicationPath}` };
  }
  const bookingPath = pathHit(BOOKING_PATHS);
  if (bookingPath) {
    return { type: "booking", visitorReceives: ["coaching"], reason: `path ${bookingPath}` };
  }
  const educationPath = pathHit(EDUCATION_PATHS);
  if (educationPath) {
    return {
      type: "education",
      visitorReceives: ["education", "coaching"],
      reason: `path ${educationPath}`,
    };
  }
  const leadMagnetPath = pathHit(LEAD_MAGNET_PATHS);
  if (leadMagnetPath) {
    return { type: "lead_magnet", visitorReceives: ["education"], reason: `path ${leadMagnetPath}` };
  }
  const storePath = pathHit(STORE_PATHS);
  if (storePath) {
    return { type: "store", visitorReceives: ["commerce_product"], reason: `path ${storePath}` };
  }

  if (educationHits >= 2) {
    return {
      type: "education",
      visitorReceives: ["education"],
      reason: `education language x${educationHits}`,
    };
  }
  if (agencyComponents >= 2) {
    return {
      type: "agency_service",
      visitorReceives: ["done_for_you_service"],
      reason: `partial agency bundle x${agencyComponents}`,
    };
  }

  return { type: "unknown", visitorReceives: ["unknown"], reason: "no decisive host, path, or content signal" };
}

export function isSocialHost(url: string): boolean {
  const host = hostOf(url) ?? "";
  return SOCIAL_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

export function isYouTubeHost(url: string): boolean {
  const host = hostOf(url) ?? "";
  return YOUTUBE_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

export function isLinkHubHost(url: string): boolean {
  const host = hostOf(url) ?? "";
  return LINK_HUB_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) if (pattern.test(text)) count += 1;
  return count;
}

export function matchedPhrases(text: string, patterns: RegExp[], limit = 4): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const at = match.index ?? 0;
      out.push(clean(text.slice(Math.max(0, at - 60), at + match[0].length + 90)));
      if (out.length >= limit) break;
    }
  }
  return out;
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function absolutize(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function pathOf(raw: string): string {
  try {
    return new URL(raw).pathname;
  } catch {
    return "";
  }
}

function dedupeCtas(ctas: ExtractedCta[]): ExtractedCta[] {
  const seen = new Set<string>();
  const out: ExtractedCta[] = [];
  for (const cta of ctas) {
    const key = `${cta.label.toLowerCase()}|${cta.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cta);
  }
  return out;
}
