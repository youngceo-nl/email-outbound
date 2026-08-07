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
  /** Signals that a form exists on the page, and what it asks for. */
  form_signals: string[];
  service_delivery_signals: string[];
  education_delivery_signals: string[];
  proof_claims: string[];
  /*
   * Checkout/enrolment/price-commitment evidence — separates "a course
   * exists" from "a PAID course exists", which the spec needs repeatedly
   * ("do not qualify based solely on a free course").
   */
  paid_offer_signals: string[];
  /** "doors closed", "waitlist", "sold out" — feeds offer-active evidence. */
  offer_status_signals: string[];
  /** Meta/TikTok/Google Ads pixels and GTM — the spec's retargeting signal. */
  tracking_signals: string[];
  destination_type: DestinationType;
  /*
   * When a page carries signals for more than one model, all of them are kept.
   * Forcing a single answer here is exactly how an agency running a course, or a
   * coach running a small service arm, gets silently mislabeled before the AI or
   * a reviewer ever sees the ambiguity.
   */
  candidate_types: DestinationType[];
  classification_state: "resolved" | "conflicting" | "unknown";
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

const PROOF_PATTERNS = [
  /\b(helped|coached|trained|taught|mentored|served)\s+(?:over\s+|\+)?[\d,]+\+?\s+[a-z]+/i,
  /\b[\d,]+\+?\s+(clients|students|members|customers)\b/i,
  /[$€£]\s?[\d,.]+\s?(k|m|million)?\s+(in\s+)?(revenue|sales|generated|collected)/i,
  /\b(testimonial|case stud(y|ies)|success stor(y|ies)|client results|student wins)\b/i,
  /\b(before and after|transformation)s?\b/i,
];

const FORM_FIELD_PATTERNS = [
  /\b(email|e-mail)\b/i, /\bphone\b/i, /\bname\b/i, /\brevenue\b/i,
  /\bbudget\b/i, /\bapplication\b/i, /\bmonthly income\b/i, /\bwebsite\b/i,
  /\binstagram\b/i, /\bwhat.s your\b/i,
];

const PRICE_PATTERN =
  /[$€£]\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:\s?k\b)?(?:\s?\/\s?(?:mo|month|yr|year|wk|week)\b|\s?per\s+(?:month|year|week)\b)?/gi;

/*
 * Checkout/enrolment/price-commitment phrases. Distinct from EDUCATION_CONTENT
 * and CTA_TEXT patterns above: those detect that an offer exists at all, these
 * detect that money is meant to change hands for it.
 */
const PAID_OFFER_PATTERNS = [
  /\benroll(ment)?\s+now\b/i, /\bbuy now\b/i, /\badd to cart\b/i, /\bproceed to checkout\b/i,
  /\bpayment plan\b/i, /\bin(stallments|stalments)\b/i, /\bpay in full\b/i,
  /\bmonthly payment\b/i, /\bone[- ]time payment\b/i, /\bsecure your (spot|seat)\b/i,
  /\bpurchase (now|access|the course|the program)\b/i, /\bpricing\b/i, /\binvestment:\s?[$€£]/i,
];

/** Hosts that only ever appear when a real payment/checkout flow is present. */
const PAID_CHECKOUT_HOSTS = [
  "stripe.com", "checkout.stripe.com", "thrivecart.com", "samcart.com",
  "paypal.com", "checkout.square.site", "gumroad.com",
];

const OFFER_STATUS_PATTERNS = [
  /\bdoors (are |is )?closed\b/i, /\bwaitlist\b/i, /\bjoin the waitlist\b/i, /\bsold out\b/i,
  /\benrollment (is |are )?(open|closed|closing)\b/i, /\bapplications? (open|close)s? \w+ \d{1,2}\b/i,
  /\bcohort (starts|begins)\b/i, /\bno longer (available|accepting|active)\b/i,
  /\bclosed for enrollment\b/i, /\bthis (program|course|offer) (is|has) ended\b/i,
];

/*
 * Matched against RAW html — before scripts are stripped for the excerpt —
 * because the tags carrying these signals are exactly what gets removed.
 * "Retargeting or paid-ad indicators" per the spec, and it costs nothing: the
 * bytes are already downloaded.
 */
const TRACKING_PIXEL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "meta_pixel", pattern: /\bfbq\(|connect\.facebook\.net\/[^"'\s]*\/fbevents\.js/i },
  { name: "tiktok_pixel", pattern: /\bttq\.load\(|analytics\.tiktok\.com/i },
  { name: "google_ads", pattern: /googleadservices\.com|gtag\(\s*['"]config['"]\s*,\s*['"]AW-/i },
  { name: "google_tag_manager", pattern: /googletagmanager\.com\/gtm\.js/i },
  { name: "snapchat_pixel", pattern: /sc-static\.net\/scevent\.min\.js/i },
  { name: "pinterest_tag", pattern: /s\.pinimg\.com\/ct\/core\.js/i },
];

export function detectTrackingPixels(rawHtml: string): string[] {
  const found: string[] = [];
  for (const { name, pattern } of TRACKING_PIXEL_PATTERNS) {
    if (pattern.test(rawHtml)) found.push(name);
  }
  return found;
}

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

  // Forms are the strongest application/booking signal a page can carry.
  const formSignals: string[] = [];
  $("form").each((_, el) => {
    if (formSignals.length >= 12) return;
    const action = clean($(el).attr("action") ?? "");
    if (action) formSignals.push(`form_action:${action}`);
    $(el)
      .find("input, textarea, select")
      .each((__, field) => {
        if (formSignals.length >= 12) return;
        const name = clean($(field).attr("name") ?? $(field).attr("placeholder") ?? "");
        if (name && FORM_FIELD_PATTERNS.some((pattern) => pattern.test(name))) {
          formSignals.push(`form_field:${name.slice(0, 60)}`);
        }
      });
  });
  // Calendar and form embeds live in iframes and never appear as <form>.
  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (/calendly|cal\.com|acuity|typeform|tally|jotform|hubspot|savvycal|youcanbook/i.test(src)) {
      formSignals.push(`embed:${(hostOf(src) ?? src).slice(0, 60)}`);
    }
  });

  const bodyText = extractBodyText($);
  const prices = [...new Set([...bodyText.matchAll(PRICE_PATTERN)].map((m) => m[0].trim()))].slice(0, 12);

  const serviceSignals = matchedPhrases(bodyText, [
    ...SERVICE_DELIVERY_PATTERNS,
    ...TEAM_PERFORMANCE_PATTERNS,
    ...SERVICE_CTA_PATTERNS,
  ], 6);
  const educationSignals = matchedPhrases(bodyText, EDUCATION_CONTENT_PATTERNS, 6);
  const proofClaims = matchedPhrases(bodyText, PROOF_PATTERNS, 6);

  const paidOfferSignals = matchedPhrases(bodyText, PAID_OFFER_PATTERNS, 6);
  for (const link of outbound) {
    const linkHost = hostOf(link.url);
    if (linkHost && PAID_CHECKOUT_HOSTS.some((host) => linkHost === host || linkHost.endsWith(`.${host}`))) {
      paidOfferSignals.push(`checkout_host:${linkHost}`);
    }
  }
  const offerStatusSignals = matchedPhrases(bodyText, OFFER_STATUS_PATTERNS, 6);
  const trackingSignals = detectTrackingPixels(opts.html);

  const classification = classifyDestination({
    url: opts.url,
    canonicalUrl: canonical,
    title: pageTitle,
    metaDescription,
    headings,
    offerCopy,
    ctaLabels,
    bodyText,
    formSignals,
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
    form_signals: [...new Set(formSignals)],
    service_delivery_signals: serviceSignals,
    education_delivery_signals: educationSignals,
    proof_claims: proofClaims,
    paid_offer_signals: [...new Set(paidOfferSignals)],
    offer_status_signals: offerStatusSignals,
    tracking_signals: trackingSignals,
    destination_type: classification.type,
    candidate_types: classification.candidateTypes,
    classification_state: classification.state,
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

export type DestinationClassification = {
  type: DestinationType;
  candidateTypes: DestinationType[];
  state: "resolved" | "conflicting" | "unknown";
  visitorReceives: VisitorOutcome[];
  reason: string;
};

const TYPE_OUTCOMES: Record<string, VisitorOutcome[]> = {
  application: ["unknown"],
  booking: ["coaching"],
  education: ["education", "coaching"],
  lead_magnet: ["education"],
  community: ["community"],
  agency_service: ["done_for_you_service"],
  store: ["commerce_product"],
  youtube: ["education"],
  link_hub: ["unknown"],
  unknown: ["unknown"],
};

/*
 * Deterministic-signals-first classification. Every signal that fires is kept as
 * a candidate; the strongest becomes `type`. When an information signal and an
 * agency signal both fire, the state is `conflicting` and the primary type is
 * deliberately left `unknown` — that is precisely the case the spec sends to the
 * AI and then to targeted review, and collapsing it here would hide it.
 */
export function classifyDestination(opts: {
  url: string;
  canonicalUrl?: string | null;
  title: string | null;
  metaDescription: string | null;
  headings: string[];
  offerCopy: string[];
  ctaLabels: ExtractedCta[];
  bodyText: string;
  formSignals?: string[];
}): DestinationClassification {
  const host = hostOf(opts.url) ?? "";
  const path = pathOf(opts.url).toLowerCase();
  const formSignals = opts.formSignals ?? [];
  const matchesHost = (list: string[]) =>
    list.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));

  const resolve = (type: DestinationType, reason: string): DestinationClassification => ({
    type,
    candidateTypes: [type],
    state: "resolved",
    visitorReceives: TYPE_OUTCOMES[type] ?? ["unknown"],
    reason,
  });

  // --- Host-level classification is the most reliable signal available. ---
  if (matchesHost(YOUTUBE_HOSTS)) return resolve("youtube", "youtube host");
  if (matchesHost(LINK_HUB_HOSTS)) return resolve("link_hub", "link hub host");
  if (matchesHost(BOOKING_HOSTS)) return resolve("booking", "booking platform host");
  if (matchesHost(COMMUNITY_HOSTS)) return resolve("community", "community platform host");
  if (matchesHost(FORM_HOSTS)) return resolve("application", "form platform host");
  if (matchesHost(STORE_HOSTS)) return resolve("store", "store platform host");
  if (matchesHost(COURSE_HOSTS)) return resolve("education", "course platform host");

  // --- Embedded booking/form widgets are as decisive as the host. ---
  const bookingEmbed = formSignals.find((signal) =>
    /^embed:(calendly|cal\.com|acuity|savvycal|youcanbook|hey)/i.test(signal),
  );
  if (bookingEmbed) return resolve("booking", `booking embed (${bookingEmbed})`);

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
  const agencyReliable = agencyComponents >= 2 && serviceDelivery > 0;

  const candidates: Array<{ type: DestinationType; weight: number; reason: string }> = [];

  if (agencyReliable) {
    candidates.push({
      type: "agency_service",
      weight: 6,
      reason: `agency bundle: delivery=${serviceDelivery} team=${teamPerformance} cta=${serviceCta}`,
    });
  } else if (agencyComponents >= 2) {
    candidates.push({ type: "agency_service", weight: 3, reason: `partial agency bundle x${agencyComponents}` });
  }

  const applicationForm = formSignals.some((signal) => /application|apply/i.test(signal));
  const pathHit = (paths: string[]) => paths.find((candidate) => path.includes(candidate));

  const applicationPath = pathHit(APPLICATION_PATHS);
  if (applicationPath || applicationForm) {
    candidates.push({
      type: "application",
      weight: 5,
      reason: applicationPath ? `path ${applicationPath}` : "application form fields",
    });
  }
  const bookingPath = pathHit(BOOKING_PATHS);
  if (bookingPath) candidates.push({ type: "booking", weight: 5, reason: `path ${bookingPath}` });

  const educationPath = pathHit(EDUCATION_PATHS);
  if (educationPath) candidates.push({ type: "education", weight: 5, reason: `path ${educationPath}` });

  const leadMagnetPath = pathHit(LEAD_MAGNET_PATHS);
  if (leadMagnetPath) candidates.push({ type: "lead_magnet", weight: 4, reason: `path ${leadMagnetPath}` });

  const storePath = pathHit(STORE_PATHS);
  if (storePath) candidates.push({ type: "store", weight: 4, reason: `path ${storePath}` });

  if (educationHits >= 2 && !educationPath) {
    candidates.push({ type: "education", weight: 3, reason: `education language x${educationHits}` });
  }

  if (candidates.length === 0) {
    return {
      type: "unknown",
      candidateTypes: [],
      state: "unknown",
      visitorReceives: ["unknown"],
      reason: "no decisive host, path, form, or content signal",
    };
  }

  candidates.sort((a, b) => b.weight - a.weight);
  const uniqueTypes = [...new Set(candidates.map((candidate) => candidate.type))];

  const INFORMATION_TYPES: DestinationType[] = ["education", "lead_magnet", "community", "application", "booking"];
  const hasAgency = uniqueTypes.includes("agency_service");
  const hasInformation = uniqueTypes.some((type) => INFORMATION_TYPES.includes(type));

  // An information page and a service page on the same destination is a genuine
  // business-model conflict — preserve it rather than picking a winner.
  if (hasAgency && hasInformation) {
    return {
      type: "unknown",
      candidateTypes: uniqueTypes,
      state: "conflicting",
      visitorReceives: ["unknown"],
      reason: `conflicting signals: ${candidates.map((c) => `${c.type}(${c.reason})`).join("; ")}`,
    };
  }

  const winner = candidates[0];
  return {
    type: winner.type,
    candidateTypes: uniqueTypes,
    state: uniqueTypes.length > 1 ? "conflicting" : "resolved",
    visitorReceives: TYPE_OUTCOMES[winner.type] ?? ["unknown"],
    reason: winner.reason,
  };
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
