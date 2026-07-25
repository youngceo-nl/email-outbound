import { inngest } from "@/inngest/client";
import { connectBrowser } from "@/lib/browser/connect";
import { enrichFunnelForLead } from "@/lib/funnel/enrich";
import { buildReport } from "@/lib/report/build";
import { FORMULA_VERSION } from "@/lib/report/calculations/formulas";
import { generateNarrative } from "@/lib/report/narrative";
import { buildReportHtml } from "@/lib/report/renderer/html";
import { fetchProspectImage } from "@/lib/report/renderer/prospect-image";
import {
  getLeadForReport,
  getReport,
  markFailed,
  markGenerating,
  markReady,
  saveContent,
  uploadPdf,
} from "@/lib/report/service";
import { logError } from "@/lib/pipeline/persist";

/*
 * Generates one report: build the document, write the AI prose, render a PDF.
 *
 * Split into steps so Inngest can retry the expensive parts independently. The
 * ordering matters — content is saved *before* the PDF is rendered, so a browser
 * failure leaves a readable, reviewable report behind rather than nothing. PDF
 * rendering is the least reliable step (it depends on an external browser) and the
 * easiest to retry, so it goes last.
 */
/** Re-scrape an offer page only if the last extraction is older than this. */
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export const generateReport = inngest.createFunction(
  { id: "generate-report", name: "Generate opportunity report", retries: 2 },
  { event: "report/generate.requested" },
  async ({ event, step }) => {
    const { report_id } = event.data;

    const report = await step.run("load-report", async () => {
      const row = await getReport(report_id);
      if (!row) throw new Error(`report ${report_id} not found`);
      await markGenerating(report_id);
      return row;
    });

    /*
     * Read their offer page before modelling anything.
     *
     * This is what turns a report full of assumptions into one with an observed
     * price, so it runs first and its result changes every revenue figure
     * downstream. Skipped when a recent extraction already exists — the enricher
     * spends ScrapingBee credits and an LLM call.
     *
     * Deliberately non-fatal: a Cloudflare block or a dead link is a normal
     * outcome, and the report still generates with the price labelled as an
     * assumption. Failing the whole job over it would be the wrong trade.
     */
    await step.run("enrich-offer-page", async () => {
      const lead = await getLeadForReport(report.lead_id);
      if (!lead?.external_link) return { skipped: "no external link on the lead" };

      const age = lead.funnel_extracted_at ? Date.now() - new Date(lead.funnel_extracted_at).getTime() : Infinity;
      if (age < STALE_AFTER_MS) return { skipped: "recent extraction already on file" };

      try {
        const result = await enrichFunnelForLead({ leadId: lead.id, externalLink: lead.external_link });
        return { ok: result.ok, price: result.funnel_price, platform: result.funnel_platform };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logError({ context: "generate-report/enrich-offer-page", error_message: `lead ${lead.id}: ${message}` });
        return { failed: message.slice(0, 300) };
      }
    });

    // Built and saved as one step: the document is worthless half-written, and
    // rebuilding it is cheap compared to re-running the narrative model.
    const built = await step.run("build-document", async () => {
      const lead = await getLeadForReport(report.lead_id);
      if (!lead) throw new Error(`lead ${report.lead_id} not found`);

      const result = buildReport({
        lead,
        overrides: report.overrides_json ?? undefined,
        confirmedBy: report.confirmed_by,
      });

      // The model rewrites the argued prose in place, constrained to the facts
      // already assembled. It cannot introduce a figure — anything numeric it
      // emits that does not trace to the fact set or the calculator is rejected
      // and the template sentence is kept instead.
      const content = await generateNarrative({
        content: result.content,
        facts: result.facts,
        signals: result.signals,
        scenarios: result.scenarios,
      });

      await saveContent(report_id, {
        content,
        scenarios: result.scenarios,
        inputs: result.resolution.inputs,
        formulaVersion: FORMULA_VERSION,
      });

      return { content, profilePicUrl: lead.profile_pic_url };
    });

    /*
     * Best-effort by design. Chromium cannot launch on a serverless runtime, so
     * this needs BROWSER_WS_ENDPOINT pointing at a remote browser — and if that is
     * not configured, the right outcome is a report you can read and print
     * yourself, not a failed job. The document is already saved by this point.
     */
    await step.run("render-pdf", async () => {
      const photo = await fetchProspectImage(built.profilePicUrl);
      const html = await buildReportHtml(built.content, {
        prospectPhoto: photo.ok ? photo.image.dataUri : null,
      });

      try {
        const { browser, context } = await connectBrowser({ headless: true });
        try {
          const page = await context.newPage();
          // setContent rather than navigating to the preview route: the HTML is
          // fully self-contained (fonts and images inlined), so a remote browser
          // has nothing to fetch back from us and no auth hop to arrange.
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

          await markReady(report_id, await uploadPdf(report_id, Buffer.from(pdf)));
          return { pdf: true };
        } finally {
          await browser.close();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markReady(
          report_id,
          null,
          "Ready to read. Automatic PDF rendering is unavailable — open the preview and print to PDF, or set BROWSER_WS_ENDPOINT to enable it.",
        );
        await logError({ context: "generate-report/render-pdf", error_message: `report ${report_id}: ${message}` });
        return { pdf: false, reason: message.slice(0, 300) };
      }
    });

    return { report_id, status: "ready" };
  },
);

/*
 * Chromium renders header and footer templates in their own document, so the
 * embedded CB fonts are not available to them — hence a generic monospace stack
 * rather than CB Geist Mono. Page numbers come from pdf() because Chromium
 * ignores CSS @page margin boxes.
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

/*
 * Inngest retries the steps above, but a run can still exhaust its attempts — a
 * browser endpoint that is down, or a lead deleted mid-flight. Without this the
 * row would sit on "generating" forever and the UI would spin with no explanation.
 */
export const reportGenerationFailed = inngest.createFunction(
  { id: "report-generation-failed", name: "Mark a failed report" },
  { event: "inngest/function.failed", if: "event.data.function_id == 'email-outbound-generate-report'" },
  async ({ event }) => {
    const reportId = (event.data?.event?.data as { report_id?: string } | undefined)?.report_id;
    if (!reportId) return { skipped: "no report_id on the failed event" };

    const message = event.data?.error?.message ?? "Report generation failed";
    await markFailed(reportId, message);
    await logError({ context: "generate-report", error_message: `report ${reportId}: ${message}` });
    return { report_id: reportId, status: "failed" };
  },
);
