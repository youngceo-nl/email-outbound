import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { classifyFunnel } from "./classify";
import { pickBestFunnelLink } from "./drill";
import { extractFunnel } from "./extract";
import { llmExtractFunnel } from "./llm-extract";
import { freeFetchPage } from "./free-fetch";
import { extractProgramNameFromUrl } from "./program-name-from-url";

export type FunnelEnrichmentResult = {
  ok: boolean;
  funnel_url: string | null;
  funnel_platform: string | null;
  funnel_program_name: string | null;
  funnel_offer_summary: string | null;
  funnel_price: string | null;
  funnel_prices: CapturedFunnelPrice[];
  error: string | null;
};

/** Matches leads.funnel_prices entries and lib/report/ladder.ts CapturedPrice. */
export type CapturedFunnelPrice = {
  raw: string;
  label: string | null;
  url: string | null;
  source: string;
  context?: string | null;
};

/*
 * Acquisition is a plain HTTP fetch. There is no rendering fallback: the
 * ScrapingBee path this used to fall through to is gone, and Steel + Playwright
 * (already the Instagram acquisition backend, see
 * lib/instagram/steel-acquisition.ts) is not wired in here yet. A page that
 * ships its offer only after JavaScript therefore reads as thin rather than
 * failing — the LLM pass below is what recovers what it can from that.
 */
export async function enrichFunnelForLead(opts: {
  leadId: string;
  externalLink: string;
}): Promise<FunnelEnrichmentResult> {
  // Step 1: domain/URL-based name — instant, zero cost
  const domainName = extractProgramNameFromUrl(opts.externalLink);

  try {
    const settings = await getSettings();

    // Step 2: fetch the bio link itself
    const entry = await freeFetchPage(normalizeUrl(opts.externalLink));
    if (!entry) return persistError(opts.leadId, "page_fetch_failed");

    const entryClass = classifyFunnel({ url: entry.finalUrl, html: entry.html });

    let pageUrl = entry.finalUrl;
    let pageHtml = entry.html;
    let platform = entryClass.platform;
    let nameFallback = domainName;
    // Set while we are still reading the aggregator itself, so the name pass
    // below knows to strip "… | Linktree" rather than keep it as a program name.
    let onAggregator = false;
    let drillError: string | null = null;

    // Step 3: an aggregator is a list of links, not an offer — drill to the
    // most offer-like child before extracting anything.
    if (entryClass.isAggregator) {
      const child = pickBestFunnelLink({ aggregatorUrl: entry.finalUrl, html: entry.html });
      const drilled = child ? await freeFetchPage(child) : null;
      if (drilled) {
        pageUrl = drilled.finalUrl;
        pageHtml = drilled.html;
        platform = classifyFunnel({ url: drilled.finalUrl, html: drilled.html }).platform;
        nameFallback = extractProgramNameFromUrl(drilled.finalUrl) ?? domainName;
      } else {
        // The aggregator page still carries the person's or brand's own name in
        // its og:title, which beats recording nothing at all.
        onAggregator = true;
        drillError = child ? "drill_fetch_failed" : "no_drill_candidate";
      }
    }

    const cheap = extractFunnel({ html: pageHtml, platform });
    let program_name = cheap.program_name ?? nameFallback;
    if (onAggregator && program_name) {
      program_name = cleanAggregatorTitle(program_name) ?? program_name;
    }
    let offer_summary = cheap.offer_summary;
    let price = cheap.price;
    const prices: CapturedFunnelPrice[] = cheap.prices.map((p) => ({
      raw: p.raw,
      label: null,
      url: pageUrl,
      source: "offer_page",
      context: p.context,
    }));

    // The landing page is rarely where the checkout tiers live (v3 §2.2). When
    // it yielded a thin ladder, probe the site's own likely pricing paths with
    // free fetches — same origin only, bounded, and a 404 costs nothing.
    if (prices.length < 3) {
      prices.push(...(await probeSitePricingPages(pageUrl)));
    }

    if (!cheap.good_enough) {
      try {
        const { extraction } = await llmExtractFunnel({
          settings,
          url: pageUrl,
          platform,
          hints: { program_name, offer_summary, price },
          pageText: cheap.raw_text_for_llm,
          leadId: opts.leadId,
        });
        if (extraction.confidence !== "none") {
          program_name = extraction.program_name ?? program_name;
          offer_summary = extraction.offer_summary ?? offer_summary;
          price = extraction.price ?? price;
        }
        // LLM-read prices carry labels and cleaned periods the regex pass
        // cannot see; both sets go in and the ladder dedupes on the raw string.
        for (const p of extraction.prices) {
          prices.push({
            raw: p.period === "monthly" && !/[/]|per\s/i.test(p.price) ? `${p.price}/mo` : p.price,
            label: p.label,
            url: pageUrl,
            source: "llm_extract",
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return persistResult({
          leadId: opts.leadId,
          funnel_url: pageUrl,
          funnel_platform: platform,
          program: { program_name, offer_summary, price },
          prices,
          error: `llm_failed: ${msg.slice(0, 200)}`,
        });
      }
    }

    return persistResult({
      leadId: opts.leadId,
      funnel_url: pageUrl,
      funnel_platform: platform,
      program: { program_name, offer_summary, price },
      prices,
      error: drillError,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return persistError(opts.leadId, msg);
  }
}

/** Paths where sites actually list their checkout tiers. Order is likelihood. */
const PRICING_PATHS = ["/pricing", "/programs", "/join", "/offers", "/courses"];

/**
 * Probes a site's own pricing pages when the landing page yielded few prices.
 * Free fetches only, same origin, three pages max — this exists to catch the
 * $997 program two clicks behind a hero page that only says "book a call".
 */
async function probeSitePricingPages(pageUrl: string): Promise<CapturedFunnelPrice[]> {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const found: CapturedFunnelPrice[] = [];
  let fetches = 0;
  for (const path of PRICING_PATHS) {
    if (fetches >= 3 || found.length >= 6) break;
    fetches += 1;
    try {
      const page = await freeFetchPage(`${origin}${path}`);
      if (!page) continue;
      // Only accept a page that stayed on the same site — a redirect out to a
      // checkout processor is fine to read, a redirect to a different brand is not.
      const extracted = extractFunnel({ html: page.html, platform: "site" });
      for (const price of extracted.prices) {
        found.push({ raw: price.raw, label: null, url: page.finalUrl, source: "site_page", context: price.context });
      }
    } catch {
      // A dead path is the expected case.
    }
  }
  return found;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty funnel URL");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Strips common aggregator platform suffixes from og:title values.
// e.g. "Christa Miller (@clynn69) | Stan" → "Christa Miller"
// e.g. "thehouserealty Official: TikTok, Instagram | Linktree" → "thehouserealty"
function cleanAggregatorTitle(title: string): string | null {
  const cleaned = title
    .replace(/\s*Official:\s*.+$/i, "")
    .replace(/\s*\|\s*(Linktree|Stan|Beacons?|Whop|Bio\.link|Campsite)\s*$/i, "")
    .replace(/\s*\(@[^)]+\)\s*/g, "")
    .trim();
  if (cleaned.length < 3 || cleaned === title.trim()) return cleaned.length >= 3 ? cleaned : null;
  return cleaned;
}


// Reject names that are clearly not a real program offer.
function sanitizeProgramName(name: string | null): string | null {
  if (!name) return null;
  const s = name.trim();
  if (s.length < 3 || s.length > 50) return null;
  if (/^\s*@/.test(s)) return null;
  // Any pipe separator means a compound page title, not a clean program name
  if (/\s\|\s/.test(s)) return null;
  if (/^join\s+/i.test(s)) return null;
  if (/\bdiscord\b.*\b(server|community|invite)\b/i.test(s)) return null;
  // Marketing copy embedded in titles
  if (/\b(FULL COURSE|FREE TRAINING|LIVE EVENT|HOSTED BY|WEBINAR|REGISTER NOW|SIGN UP NOW)\b/i.test(s)) return null;
  // Pure lowercase no-space string → just a username/handle
  if (/^[a-z][a-z0-9]{2,}$/.test(s)) return null;
  return s;
}

async function persistResult(args: {
  leadId: string;
  funnel_url: string;
  funnel_platform: string;
  program: { program_name: string | null; offer_summary: string | null; price: string | null };
  prices: CapturedFunnelPrice[];
  error: string | null;
}): Promise<FunnelEnrichmentResult> {
  const program_name = sanitizeProgramName(args.program.program_name);
  const sb = createAdminClient();
  await sb
    .from("leads")
    .update({
      funnel_url: args.funnel_url,
      funnel_platform: args.funnel_platform,
      funnel_program_name: program_name,
      funnel_offer_summary: args.program.offer_summary,
      funnel_price: args.program.price,
      funnel_prices: args.prices.length > 0 ? args.prices : null,
      funnel_extracted_at: new Date().toISOString(),
      funnel_extraction_error: args.error,
    })
    .eq("id", args.leadId);
  return {
    ok: !args.error,
    funnel_url: args.funnel_url,
    funnel_platform: args.funnel_platform,
    funnel_program_name: program_name,
    funnel_offer_summary: args.program.offer_summary,
    funnel_price: args.program.price,
    funnel_prices: args.prices,
    error: args.error,
  };
}

async function persistError(leadId: string, error: string): Promise<FunnelEnrichmentResult> {
  const sb = createAdminClient();
  await sb
    .from("leads")
    .update({
      funnel_extracted_at: new Date().toISOString(),
      funnel_extraction_error: error,
    })
    .eq("id", leadId);
  return {
    ok: false,
    funnel_url: null,
    funnel_platform: null,
    funnel_program_name: null,
    funnel_offer_summary: null,
    funnel_price: null,
    funnel_prices: [],
    error,
  };
}
