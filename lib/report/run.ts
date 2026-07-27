import "server-only";
import { connectBrowser } from "@/lib/browser/connect";
import { enrichFunnelForLead } from "@/lib/funnel/enrich";
import { logError } from "@/lib/pipeline/persist";
import { buildReport, type NicheResearch } from "./build";
import { researchNichePricing } from "./research";
import { runGates } from "./gates";
import { collectYouTube, extractYouTubeRef, type YouTubeCollection } from "@/lib/youtube/collect";
import { getSettings } from "@/lib/config/settings";
import { FORMULA_VERSION } from "./calculations/formulas";
import { generateNarrativeDetailed } from "./narrative";
import { buildReportHtml } from "./renderer/html";
import { fetchProspectImage } from "./renderer/prospect-image";
import {
  getLeadForReport,
  getReport,
  markFailed,
  markGenerating,
  markReady,
  saveContent,
  uploadPdf,
} from "./service";

/*
 * The whole generation pipeline, as one plain async function.
 *
 * Deliberately not an Inngest function. The Inngest plan's per-function
 * concurrency ceiling is below what this app's crawler declares, so the app
 * cannot sync at all — which means a new Inngest function can never be
 * registered, no matter how it is written. Rather than throttle a working
 * crawler to ship a reporting feature, generation runs in a request.
 *
 * What that costs, stated plainly:
 *   - No automatic retries. A failure needs someone to click Generate again.
 *   - It must finish inside the platform's function timeout.
 *
 * Both are mitigated by ordering: the offer-page scrape and the document are
 * saved before the PDF is attempted, so the expensive work is never lost to a
 * late failure, and a re-run skips the scrape it already did.
 */

/** Re-scrape an offer page only if the last extraction is older than this. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type RunResult = {
  reportId: string;
  status: "ready" | "failed";
  pdf: boolean;
  /** Passages where the model invented a figure and the template was kept. */
  rejectedPassages: number;
  note?: string;
};

export async function runReport(reportId: string): Promise<RunResult> {
  const startedAt = Date.now();
  const report = await getReport(reportId);
  if (!report) throw new Error(`report ${reportId} not found`);

  await markGenerating(reportId);

  try {
    const lead = await getLeadForReport(report.lead_id);
    if (!lead) throw new Error(`lead ${report.lead_id} not found`);

    /*
     * Read their offer page first — it is what turns an assumed deal value into an
     * observed one, and it changes every revenue figure downstream.
     *
     * Non-fatal by design: a Cloudflare block or a dead link is an ordinary
     * outcome, and the report is still worth producing with the price labelled as
     * an assumption. Skipped when a recent extraction exists, since it spends
     * ScrapingBee credits and a model call.
     */
    const age = lead.funnel_extracted_at ? Date.now() - new Date(lead.funnel_extracted_at).getTime() : Infinity;
    if (lead.external_link && age > STALE_AFTER_MS) {
      try {
        await enrichFunnelForLead({ leadId: lead.id, externalLink: lead.external_link });
      } catch (err) {
        await logError({
          context: "runReport/enrich-offer-page",
          error_message: `lead ${lead.id}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Re-read: enrichment writes the price back onto the lead row.
    const enriched = (await getLeadForReport(report.lead_id)) ?? lead;

    /*
     * Live niche price research: real competitors at real prices, found by web
     * search at generation time. This is the difference between a researched
     * document and a filled-in template, and it is why generation takes minutes
     * rather than seconds.
     *
     * Skipped when the team typed a price into the generate menu — a human
     * number outranks research, same as everywhere else in the cascade. Failure
     * is non-fatal: the band falls back to the defaults table, labelled assumed.
     */
    let research: NicheResearch | null = null;
    // Skipped or failed stages are recorded ON THE ROW, not just in logs — a
    // 20-second template report with no explanation is worse than a visible one.
    const issues: string[] = [];
    if (!report.overrides_json?.front_end_price) {
      try {
        const outcome = await researchNichePricing({
          niche: enriched.niche,
          businessModel: enriched.business_model,
          bio: enriched.bio,
          offerSummary: enriched.funnel_offer_summary,
          leadId: enriched.id,
        });
        if (outcome.ok) {
          research = outcome.research;
          console.log(
            `[report] niche research (${outcome.provider}): ${outcome.research.competitors.length} comparables in ${Math.round(outcome.elapsedMs / 1000)}s`,
          );
        } else {
          issues.push(`Price research did not run (${outcome.reason}) — category band is a default.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        issues.push(`Price research failed (${msg.slice(0, 140)}) — category band is a default.`);
        await logError({ context: "runReport/niche-research", error_message: `lead ${enriched.id}: ${msg}` });
      }
    }

    /*
     * YouTube, when the prospect links a channel. Descriptions carry the offer
     * stack (v3 §2.3), subscribers widen the audience picture. Only explicitly
     * linked channels — a name-search guess can attach the wrong person's
     * channel to a report that greets them by name.
     */
    let youtube: YouTubeCollection | null = null;
    const settings = await getSettings();
    const youtubeKey = settings.youtube_api_key || process.env.YOUTUBE_API_KEY || "";
    const youtubeRef = extractYouTubeRef(enriched.bio) ?? extractYouTubeRef(enriched.external_link);
    if (youtubeKey && youtubeRef) {
      try {
        youtube = await collectYouTube({ apiKey: youtubeKey, ref: youtubeRef });
        if (youtube) {
          console.log(
            `[report] youtube: ${youtube.title} — ${youtube.subscribers ?? "?"} subs, ${youtube.capturedPrices.length} prices in descriptions`,
          );
        }
      } catch (err) {
        issues.push(`YouTube collection failed (${err instanceof Error ? err.message.slice(0, 120) : String(err)}).`);
      }
    } else if (youtubeRef && !youtubeKey) {
      issues.push("A YouTube channel is linked but no YouTube API key is configured — channel data not collected.");
    }

    const platforms = [
      ...(enriched.followers ? [{ platform: "Instagram", audience: enriched.followers, detail: "followers" }] : []),
      ...(youtube?.subscribers
        ? [{ platform: "YouTube", audience: youtube.subscribers, detail: `${youtube.uploadsLast30Days} uploads / 30d` }]
        : []),
    ];

    const built = buildReport({
      lead: enriched,
      overrides: report.overrides_json ?? undefined,
      confirmedBy: report.confirmed_by,
      research,
      extraPrices: youtube?.capturedPrices ?? null,
      platforms: platforms.length > 0 ? platforms : null,
    });

    /*
     * Two model passes: analyse the prospect from their own words, then argue the
     * findings into prose. The lead is passed so the dossier can include the raw
     * bio and post captions — handing the model only formatted metrics was what
     * made the earlier output generic.
     */
    const narrative = await generateNarrativeDetailed({
      lead: enriched,
      content: built.content,
      facts: built.facts,
      signals: built.signals,
      scenarios: built.scenarios,
      ladder: built.ladder,
      youtube: youtube
        ? {
            channel: youtube.title,
            subscribers: youtube.subscribers,
            uploads_last_30_days: youtube.uploadsLast30Days,
            recent_video_titles: youtube.videos.slice(0, 8).map((v) => v.title),
          }
        : null,
    });

    // Saved before the PDF is attempted: the document is the expensive part, and a
    // browser failure must not discard it.
    await saveContent(reportId, {
      content: narrative.content,
      scenarios: built.scenarios,
      inputs: built.resolution.inputs,
      formulaVersion: FORMULA_VERSION,
    });

    if (!narrative.usedModel) {
      issues.push(`AI analysis did not run (${narrative.rejected[0]?.reason ?? "unknown"}) — template prose only.`);
    }

    /*
     * v3 §9: the gates run on every generation, not just in the dev script. A
     * failure is a loud note rather than a hard abort — a report with a flagged
     * phrase is reviewable; a generation that dies at the last step after paying
     * for research and model passes is not.
     */
    try {
      const { buildReportHtml } = await import("./renderer/html");
      const gateHtml = await buildReportHtml(narrative.content);
      for (const failure of runGates(gateHtml)) {
        issues.push(`GATE: ${failure.name} — ${failure.excerpts[0] ?? ""}`);
      }
    } catch (err) {
      console.warn(`[report] gates failed to run: ${err instanceof Error ? err.message : String(err)}`);
    }

    const preRenderElapsed = Math.round((Date.now() - startedAt) / 1000);
    if (preRenderElapsed < 90 && issues.length === 0) {
      issues.push(`Generated in ${preRenderElapsed}s — under the 90s research floor; check which stage no-opped.`);
    }

    const pdf = await renderPdf(reportId, narrative.content, enriched.profile_pic_url, issues);

    /*
     * The 15-seconds tell (v3 §1/§9): a report that generated that fast
     * researched nothing, verified nothing, and considered nothing — one of the
     * stages silently no-opped. Logged loudly rather than failed, because a
     * human-priced report legitimately skips research and runs faster.
     */
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    if (elapsedSec < 90) {
      console.warn(
        `[report] ${reportId} completed in ${elapsedSec}s — under the 90s floor. ` +
          `Research ${research ? "ran" : "did not run"}; model passes ${narrative.usedModel ? "ran" : "did not run"}. ` +
          `If neither was deliberately skipped, a stage silently no-opped.`,
      );
    } else {
      console.log(`[report] ${reportId} completed in ${elapsedSec}s`);
    }

    return {
      reportId,
      status: "ready",
      pdf: pdf.ok,
      rejectedPassages: narrative.rejected.length,
      note: pdf.ok ? undefined : pdf.note,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(reportId, message);
    await logError({ context: "runReport", error_message: `report ${reportId}: ${message}` });
    return { reportId, status: "failed", pdf: false, rejectedPassages: 0, note: message };
  }
}

/**
 * Best-effort PDF.
 *
 * Chromium cannot launch on a serverless runtime, so this needs
 * BROWSER_WS_ENDPOINT pointing at a remote browser. When that is absent the right
 * outcome is a report you can read and print yourself, not a failure — the
 * preview route serves the same HTML and its stylesheet is already A4, so Ctrl+P
 * produces the same document.
 */
async function renderPdf(
  reportId: string,
  content: Awaited<ReturnType<typeof buildReport>>["content"],
  profilePicUrl: string | null,
  issues: string[] = [],
): Promise<{ ok: true } | { ok: false; note: string }> {
  const NOTE =
    "Ready to read. Automatic PDF rendering is unavailable — open the preview and print to PDF, or set BROWSER_WS_ENDPOINT to enable it.";

  try {
    const photo = await fetchProspectImage(profilePicUrl);
    const html = await buildReportHtml(content, { prospectPhoto: photo.ok ? photo.image.dataUri : null });

    const { browser, context } = await connectBrowser({ headless: true });
    try {
      const page = await context.newPage();
      // setContent rather than navigating: the HTML is fully self-contained
      // (fonts and images inlined), so a remote browser has nothing to fetch back
      // from us and no auth hop to arrange.
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);

      const pdf = await page.pdf({
        format: "A4",
        margin: { top: "16mm", bottom: "14mm", left: "0", right: "0" },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: HEADER,
        footerTemplate: FOOTER,
      });

      await markReady(reportId, await uploadPdf(reportId, Buffer.from(pdf)), issues.length ? issues.join(" ") : undefined);
      return { ok: true };
    } finally {
      await browser.close();
    }
  } catch (err) {
    await markReady(reportId, null, [NOTE, ...issues].join(" "));
    await logError({
      context: "runReport/render-pdf",
      error_message: `report ${reportId}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false, note: NOTE };
  }
}

/*
 * Chromium renders header and footer templates in their own document, so the
 * embedded CB fonts are unavailable to them — hence a generic monospace stack.
 * Page numbers come from pdf() because Chromium ignores CSS @page margin boxes.
 */
const HEADER = `
<div style="font-family:ui-monospace,'Courier New',monospace;font-size:7pt;width:100%;
            padding:0 18mm;display:flex;justify-content:space-between;letter-spacing:.12em;">
  <span style="color:#ef382b;font-weight:700;">CONVERSION BRANDS</span>
  <span style="color:#7a7068;">WEBINAR STRATEGY</span>
</div>`;

const FOOTER = `
<div style="font-family:ui-monospace,'Courier New',monospace;font-size:7pt;width:100%;
            padding:0 18mm;display:flex;justify-content:space-between;color:#7a7068;">
  <span>Prepared by Conversion Brands · Planning document</span>
  <span class="pageNumber"></span>
</div>`;
