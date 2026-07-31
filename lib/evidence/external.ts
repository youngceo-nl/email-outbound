/*
 * Bounded external commercial evidence collection.
 *
 * Replaces "resolve one best link" with "inventory every commercially relevant
 * destination and keep the CTA chain that connects them". The collector writes
 * no qualification conclusions — it records what was inspected, what was found,
 * and precisely why it stopped.
 *
 * Acquisition is read-only. Nothing here submits an application, books a call,
 * joins a community, creates an account, or passes an authentication wall.
 */

import type {
  AcquisitionStopReason,
  CaptureStatus,
  CommercialRelevance,
  CtaHop,
  DestinationType,
  ExternalDestination,
} from "@/lib/qualification/types";
import { canonicalizeUrl, freeFetchPage, scrapingBeeFetchPage, type PageFetchOutcome } from "./http";
import {
  extractPage,
  isLinkHubHost,
  isSocialHost,
  isYouTubeHost,
  type PageExtraction,
} from "./page-extract";

// ---------------------------------------------------------------------------
// Link ranking
// ---------------------------------------------------------------------------

export type RankedLink = {
  url: string;
  label: string;
  score: number;
  reasons: string[];
  relevance: CommercialRelevance;
};

/*
 * Semantic groups from the spec's link-hub child selection rules. Scored by
 * group rather than by raw keyword count so a label repeating "coaching" three
 * times does not outrank a distinct "apply" destination.
 */
const LABEL_SIGNALS: Array<{ group: string; weight: number; pattern: RegExp }> = [
  { group: "apply", weight: 6, pattern: /\bappl(y|ication)\b/i },
  { group: "book", weight: 6, pattern: /\b(book|schedule)\b.*\b(call|session|consult)|^\s*(book|schedule)\b/i },
  { group: "coaching", weight: 6, pattern: /\b(1[:-]?1|one[- ]on[- ]one|private|group)?\s*(coaching|mentorship|mentoring)\b/i },
  { group: "program", weight: 5, pattern: /\b(program|academy|university|accelerator|mastermind|bootcamp|challenge)\b/i },
  { group: "free_education", weight: 5, pattern: /\bfree\s+(training|course|masterclass|webinar|workshop|guide|video)\b/i },
  { group: "asset", weight: 5, pattern: /\b(blueprint|roadmap|playbook|guide|checklist|template)\b/i },
  { group: "community", weight: 4, pattern: /\b(community|inner circle|vip|membership|join)\b/i },
  { group: "learn", weight: 4, pattern: /\b(learn|training|course|masterclass|webinar|workshop|lesson)\b/i },
  { group: "work_with_me", weight: 4, pattern: /\bwork with (me|us)\b/i },
  { group: "watch", weight: 3, pattern: /\b(watch|video|youtube|episode)\b/i },
  { group: "trade_live", weight: 3, pattern: /\btrade live\b/i },
  { group: "results", weight: 2, pattern: /\b(results|testimonials|case stud(y|ies)|wins)\b/i },
];

const PATH_SIGNALS: Array<{ group: string; weight: number; pattern: RegExp }> = [
  { group: "path_apply", weight: 5, pattern: /\/(apply|application|qualify|intake)/i },
  { group: "path_book", weight: 5, pattern: /\/(book|call|schedule|strategy-call|discovery)/i },
  { group: "path_education", weight: 5, pattern: /\/(course|program|coaching|academy|mentorship|mastermind|membership|accelerator)/i },
  { group: "path_lead_magnet", weight: 4, pattern: /\/(free|training|webinar|masterclass|blueprint|roadmap|guide|optin|opt-in|vsl|download)/i },
];

const DEPRIORITIZED: Array<{ group: string; penalty: number; pattern: RegExp }> = [
  { group: "legal", penalty: 12, pattern: /\/(privacy|terms|tos|legal|imprint|disclaimer|cookie)/i },
  { group: "contact", penalty: 5, pattern: /\/(contact|support|help|faq|about)/i },
  { group: "discount", penalty: 4, pattern: /\b(discount|promo|coupon|code|affiliate|ref=)\b/i },
  { group: "broker", penalty: 4, pattern: /\b(broker|exness|icmarkets|bybit|binance|deriv)\b/i },
];

export function rankFunnelLinks(opts: {
  pageUrl: string;
  extraction: PageExtraction;
}): RankedLink[] {
  const originHost = safeHost(opts.pageUrl);
  const ranked = new Map<string, RankedLink>();

  for (const link of opts.extraction.outbound_links) {
    const canonical = canonicalizeUrl(link.url);
    if (!canonical) continue;
    if (canonical === canonicalizeUrl(opts.pageUrl)) continue;

    const label = link.label.trim();
    const reasons: string[] = [];
    let score = 0;

    const seenGroups = new Set<string>();
    for (const signal of LABEL_SIGNALS) {
      if (seenGroups.has(signal.group)) continue;
      if (label && signal.pattern.test(label)) {
        score += signal.weight;
        seenGroups.add(signal.group);
        reasons.push(`label:${signal.group}`);
      }
    }
    for (const signal of PATH_SIGNALS) {
      if (signal.pattern.test(canonical)) {
        score += signal.weight;
        reasons.push(signal.group);
      }
    }
    for (const signal of DEPRIORITIZED) {
      if (signal.pattern.test(canonical) || (label && signal.pattern.test(label))) {
        score -= signal.penalty;
        reasons.push(`penalty:${signal.group}`);
      }
    }

    /*
     * Social profiles stay in the inventory because they can still change a
     * business-model conclusion, but they never outrank a real destination.
     * YouTube is the exception the spec calls out: it is a genuine funnel
     * surface, not noise.
     */
    if (isYouTubeHost(canonical)) {
      score += 4;
      reasons.push("youtube_destination");
    } else if (isSocialHost(canonical)) {
      score -= 8;
      reasons.push("penalty:social_profile");
    }

    if (safeHost(canonical) === originHost) {
      score += 1;
      reasons.push("same_origin");
    }

    const existing = ranked.get(canonical);
    if (existing) {
      existing.score += 1;
      existing.reasons.push("repeat");
      if (!existing.label && label) existing.label = label;
      continue;
    }
    ranked.set(canonical, {
      url: canonical,
      label,
      score,
      reasons,
      relevance: "incidental",
    });
  }

  const sorted = [...ranked.values()].sort((a, b) => b.score - a.score);
  for (const link of sorted) {
    link.relevance = link.score >= 5 ? "primary" : link.score > 0 ? "supporting" : "incidental";
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export type ExternalCollectorConfig = {
  /** Commercial hops to follow by default. */
  defaultHopBudget: number;
  /** Absolute ceiling regardless of unresolved questions. */
  absoluteHopBudget: number;
  /** Link-hub children inspected before the collector needs a reason to continue. */
  defaultChildBudget: number;
  maxChildBudget: number;
  scrapingBeeApiKey: string | null;
};

export const DEFAULT_EXTERNAL_CONFIG: ExternalCollectorConfig = {
  defaultHopBudget: 3,
  absoluteHopBudget: 5,
  defaultChildBudget: 3,
  maxChildBudget: 5,
  scrapingBeeApiKey: null,
};

export type ExternalCollectionResult = {
  destinations: ExternalDestination[];
  cta_hops: CtaHop[];
  youtube_urls: string[];
  stop_reason: AcquisitionStopReason;
  capture_status: CaptureStatus;
  hops_used: number;
};

export type PageFetcher = (url: string) => Promise<PageFetchOutcome>;

/** Free fetch first, ScrapingBee only when the free attempt fails or renders nothing. */
export function createPageFetcher(config: ExternalCollectorConfig): PageFetcher {
  return async (url: string) => {
    const free = await freeFetchPage(url);
    if (free.ok && looksRendered(free.page.html)) return free;
    if (!config.scrapingBeeApiKey) return free;
    const rendered = await scrapingBeeFetchPage({ apiKey: config.scrapingBeeApiKey, url });
    return rendered.ok ? rendered : free;
  };
}

/*
 * A shell that ships no readable copy means the commercial content is behind
 * JavaScript; the spec calls for a rendering collector in exactly that case.
 */
function looksRendered(html: string): boolean {
  const withoutTags = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
  return withoutTags.replace(/\s+/g, " ").trim().length > 400;
}

export async function collectExternalEvidence(opts: {
  externalLink: string | null;
  fetcher: PageFetcher;
  config?: Partial<ExternalCollectorConfig>;
  now?: () => string;
}): Promise<ExternalCollectionResult> {
  const config = { ...DEFAULT_EXTERNAL_CONFIG, ...opts.config };
  const now = opts.now ?? (() => new Date().toISOString());

  if (!opts.externalLink) {
    return {
      destinations: [],
      cta_hops: [],
      youtube_urls: [],
      stop_reason: "no_external_link",
      capture_status: "captured",
      hops_used: 0,
    };
  }

  const root = canonicalizeUrl(opts.externalLink);
  if (!root) {
    return {
      destinations: [],
      cta_hops: [],
      youtube_urls: [],
      stop_reason: "unsupported_page",
      capture_status: "unavailable",
      hops_used: 0,
    };
  }

  const destinations: ExternalDestination[] = [];
  const ctaHops: CtaHop[] = [];
  const youtubeUrls = new Set<string>();
  const visited = new Set<string>();

  type QueueItem = {
    url: string;
    hop: number;
    label: string | null;
    reason: string;
    relevance: CommercialRelevance;
    rank: number;
    sourceId: string;
    sourceType: CtaHop["source_type"];
  };

  const queue: QueueItem[] = [
    {
      url: root,
      hop: 0,
      label: null,
      reason: "instagram bio external link",
      relevance: "primary",
      rank: 0,
      sourceId: "profile",
      sourceType: "instagram_profile",
    },
  ];

  let stopReason: AcquisitionStopReason = "complete";
  let hopsUsed = 0;
  let destinationIndex = 0;
  let cycleDetected = false;
  let anyCaptured = false;
  let anyFailed = false;

  while (queue.length > 0) {
    const item = queue.shift() as QueueItem;

    if (visited.has(item.url)) {
      cycleDetected = true;
      continue;
    }
    if (item.hop > config.absoluteHopBudget) {
      stopReason = "max_hops_reached";
      break;
    }
    visited.add(item.url);
    hopsUsed = Math.max(hopsUsed, item.hop);

    // YouTube is handed to the dedicated collector rather than scraped as HTML.
    if (isYouTubeHost(item.url)) {
      youtubeUrls.add(item.url);
      ctaHops.push({
        hop: ctaHops.length,
        source_type: item.sourceType,
        source_id: item.sourceId,
        action: "watch_on_youtube",
        destination_url: item.url,
        visitor_receives: null,
        evidence: item.label ?? item.reason,
      });
      destinations.push(
        placeholderDestination({
          id: `destination_${destinationIndex++}`,
          url: item.url,
          item,
          type: "youtube",
          status: "not_attempted",
          error: "handed to youtube collector",
          capturedAt: now(),
        }),
      );
      continue;
    }

    const outcome = await opts.fetcher(item.url);

    if (!outcome.ok) {
      anyFailed = true;
      const status: CaptureStatus =
        outcome.failure.kind === "auth_required" ? "unavailable" : "failed";
      destinations.push(
        placeholderDestination({
          id: `destination_${destinationIndex++}`,
          url: item.url,
          item,
          type: "unknown",
          status,
          error: `${outcome.failure.kind}: ${outcome.failure.detail}`,
          capturedAt: now(),
        }),
      );
      if (item.hop === 0) {
        stopReason =
          outcome.failure.kind === "auth_required" ? "authentication_required" : "destination_unavailable";
      }
      continue;
    }

    anyCaptured = true;
    const finalUrl = canonicalizeUrl(outcome.page.finalUrl) ?? item.url;
    const extraction = extractPage({ html: outcome.page.html, url: finalUrl });
    const destinationId = `destination_${destinationIndex++}`;

    destinations.push({
      destination_id: destinationId,
      source_url: item.url,
      final_url: finalUrl,
      redirect_chain: outcome.page.redirectChain,
      visible_label: item.label,
      page_title: extraction.page_title,
      meta_description: extraction.meta_description,
      headings: extraction.headings,
      cta_labels: extraction.cta_labels,
      offer_copy: extraction.offer_copy.slice(0, 25),
      prices: extraction.prices,
      destination_type: extraction.destination_type,
      visitor_receives: extraction.visitor_receives,
      commercial_relevance: item.relevance,
      selection_reason: `${item.reason} | ${extraction.classification_reason}`,
      rank: item.rank,
      hop: item.hop,
      text_excerpt: extraction.text_excerpt.slice(0, 4000),
      capture_status: "captured",
      capture_method: outcome.page.method,
      captured_at: now(),
      error: null,
    });

    ctaHops.push({
      hop: ctaHops.length,
      source_type: item.sourceType,
      source_id: item.sourceId,
      action: hopAction(extraction.destination_type, item.label),
      destination_url: finalUrl,
      visitor_receives: extraction.visitor_receives[0] ?? null,
      evidence: item.label ?? extraction.page_title ?? item.reason,
    });

    // ---- Decide whether to traverse further ----
    if (item.hop >= config.absoluteHopBudget) {
      stopReason = "max_hops_reached";
      continue;
    }

    const isHub = extraction.destination_type === "link_hub" || isLinkHubHost(finalUrl);
    const childBudget = isHub ? config.defaultChildBudget : 1;
    const beyondDefaultHops = item.hop + 1 > config.defaultHopBudget;

    /*
     * Past the default hop budget the collector only keeps going while the
     * ultimate outcome is genuinely unresolved. A resolved education or
     * done-for-you outcome is the answer; more pages cannot improve it.
     */
    if (beyondDefaultHops && outcomeResolved(destinations)) {
      stopReason = "ultimate_outcome_resolved";
      continue;
    }

    const relevant = rankFunnelLinks({ pageUrl: finalUrl, extraction }).filter(
      (link) => link.score > 0,
    );
    // A relevant link we have already inspected is a cycle in the funnel graph.
    // It has to be observed here, before the filter drops it, or the branch ends
    // silently and the stop reason claims the traversal simply completed.
    if (relevant.some((link) => visited.has(link.url))) cycleDetected = true;

    const unvisited = relevant.filter((link) => !visited.has(link.url));

    /*
     * A linked YouTube channel is handed to the YouTube API collector, which has
     * its own bounded budget, so it never consumes an HTML child slot. Letting it
     * compete would drop the channel whenever a hub also lists three offer pages
     * — exactly the case where YouTube is most likely to be the real funnel.
     */
    for (const link of unvisited.filter((candidate) => isYouTubeHost(candidate.url))) {
      youtubeUrls.add(link.url);
      visited.add(link.url);
      ctaHops.push({
        hop: ctaHops.length,
        source_type: isHub ? "link_hub" : "external_page",
        source_id: destinationId,
        action: "watch_on_youtube",
        destination_url: link.url,
        visitor_receives: null,
        evidence: link.label || link.reasons.join(","),
      });
    }

    const candidates = unvisited
      .filter((link) => !isYouTubeHost(link.url))
      .slice(0, childBudget);

    if (candidates.length === 0 && item.hop === 0 && !isHub) {
      // A terminal offer page with no onward CTA is a complete answer.
      continue;
    }

    for (const candidate of candidates) {
      queue.push({
        url: candidate.url,
        hop: item.hop + 1,
        label: candidate.label || null,
        reason: candidate.reasons.join(","),
        relevance: candidate.relevance,
        rank: candidates.indexOf(candidate),
        sourceId: destinationId,
        sourceType: isHub ? "link_hub" : "external_page",
      });
    }
  }

  /*
   * Precedence matters: a resolved visitor outcome is the answer we were after,
   * so it outranks an incidental revisit of a page reachable by two routes.
   * Reporting `cycle_detected` there would understate acquisition completeness
   * and needlessly cost the lead its high-certainty rating.
   */
  if (stopReason === "complete") {
    if (outcomeResolved(destinations)) stopReason = "ultimate_outcome_resolved";
    else if (cycleDetected) stopReason = "cycle_detected";
    else if (destinations.length === 0) stopReason = "no_commercial_action";
  }

  const captureStatus: CaptureStatus = anyCaptured
    ? "captured"
    : anyFailed
      ? "failed"
      : "not_attempted";

  return {
    destinations,
    cta_hops: ctaHops,
    youtube_urls: [...youtubeUrls],
    stop_reason: stopReason,
    capture_status: captureStatus,
    hops_used: hopsUsed,
  };
}

const RESOLVING_TYPES: DestinationType[] = [
  "education",
  "application",
  "booking",
  "community",
  "agency_service",
  "store",
  "lead_magnet",
];

function outcomeResolved(destinations: ExternalDestination[]): boolean {
  return destinations.some(
    (destination) =>
      destination.capture_status === "captured" &&
      RESOLVING_TYPES.includes(destination.destination_type),
  );
}

function hopAction(type: DestinationType, label: string | null): string {
  if (label && label.length <= 60) return label.toLowerCase().replace(/\s+/g, "_");
  switch (type) {
    case "application": return "open_application";
    case "booking": return "book_call";
    case "education": return "visit_offer_page";
    case "lead_magnet": return "claim_free_asset";
    case "community": return "join_community";
    case "link_hub": return "open_link_hub";
    case "store": return "visit_store";
    case "agency_service": return "visit_service_page";
    case "youtube": return "watch_on_youtube";
    default: return "visit_page";
  }
}

function placeholderDestination(args: {
  id: string;
  url: string;
  item: { label: string | null; reason: string; relevance: CommercialRelevance; rank: number; hop: number };
  type: DestinationType;
  status: CaptureStatus;
  error: string;
  capturedAt: string;
}): ExternalDestination {
  return {
    destination_id: args.id,
    source_url: args.url,
    final_url: null,
    redirect_chain: [args.url],
    visible_label: args.item.label,
    page_title: null,
    meta_description: null,
    headings: [],
    cta_labels: [],
    offer_copy: [],
    prices: [],
    destination_type: args.type,
    visitor_receives: [],
    commercial_relevance: args.item.relevance,
    selection_reason: args.item.reason,
    rank: args.item.rank,
    hop: args.item.hop,
    text_excerpt: null,
    capture_status: args.status,
    capture_method: "none",
    captured_at: args.capturedAt,
    error: args.error,
  };
}

function safeHost(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
