import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { fetchFunnelPage } from "./fetch";
import { classifyFunnel } from "./classify";
import { pickBestFunnelLink } from "./drill";
import { extractFunnel } from "./extract";
import { llmExtractFunnel } from "./llm-extract";

export type FunnelEnrichmentResult = {
  ok: boolean;
  funnel_url: string | null;
  funnel_platform: string | null;
  funnel_program_name: string | null;
  funnel_offer_summary: string | null;
  funnel_price: string | null;
  error: string | null;
};

export async function enrichFunnelForLead(opts: {
  leadId: string;
  externalLink: string;
}): Promise<FunnelEnrichmentResult> {
  const settings = await getSettings();
  const apiKey = settings.scrapingbee_api_key || process.env.SCRAPINGBEE_API_KEY || "";
  if (!apiKey) {
    return persistError(opts.leadId, "ScrapingBee API key not configured");
  }

  try {
    // 1. Fetch entry URL
    const entry = await fetchFunnelPage({ apiKey, url: opts.externalLink });
    const entryClass = classifyFunnel({ url: entry.finalUrl, html: entry.html });

    // 2. If aggregator, drill to the best free-course/VSL link
    let pageUrl = entry.finalUrl;
    let pageHtml = entry.html;
    let platform = entryClass.platform;

    if (entryClass.isAggregator) {
      const child = pickBestFunnelLink({ aggregatorUrl: entry.finalUrl, html: entry.html });
      if (!child) {
        return persistResult({
          leadId: opts.leadId,
          funnel_url: entry.finalUrl,
          funnel_platform: entryClass.platform,
          program: { program_name: null, offer_summary: null, price: null },
          error: "no_drill_candidate",
        });
      }
      const drilled = await fetchFunnelPage({ apiKey, url: child });
      pageUrl = drilled.finalUrl;
      pageHtml = drilled.html;
      platform = classifyFunnel({ url: drilled.finalUrl, html: drilled.html }).platform;
    }

    // 3. Cheap extractor
    const cheap = extractFunnel({ html: pageHtml, platform });

    let program_name = cheap.program_name;
    let offer_summary = cheap.offer_summary;
    let price = cheap.price;

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
      } catch (err) {
        // LLM is best-effort; persist whatever the cheap extractor found.
        const msg = err instanceof Error ? err.message : String(err);
        return persistResult({
          leadId: opts.leadId,
          funnel_url: pageUrl,
          funnel_platform: platform,
          program: { program_name, offer_summary, price },
          error: `llm_failed: ${msg.slice(0, 200)}`,
        });
      }
    }

    return persistResult({
      leadId: opts.leadId,
      funnel_url: pageUrl,
      funnel_platform: platform,
      program: { program_name, offer_summary, price },
      error: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return persistError(opts.leadId, msg);
  }
}

async function persistResult(args: {
  leadId: string;
  funnel_url: string;
  funnel_platform: string;
  program: { program_name: string | null; offer_summary: string | null; price: string | null };
  error: string | null;
}): Promise<FunnelEnrichmentResult> {
  const sb = createAdminClient();
  await sb
    .from("leads")
    .update({
      funnel_url: args.funnel_url,
      funnel_platform: args.funnel_platform,
      funnel_program_name: args.program.program_name,
      funnel_offer_summary: args.program.offer_summary,
      funnel_price: args.program.price,
      funnel_extracted_at: new Date().toISOString(),
      funnel_extraction_error: args.error,
    })
    .eq("id", args.leadId);
  return {
    ok: !args.error,
    funnel_url: args.funnel_url,
    funnel_platform: args.funnel_platform,
    funnel_program_name: args.program.program_name,
    funnel_offer_summary: args.program.offer_summary,
    funnel_price: args.program.price,
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
    error,
  };
}
