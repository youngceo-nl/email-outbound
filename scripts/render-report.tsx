/*
 * Phase 1 design gate. Renders the golden fixture to HTML and PDF with no Next,
 * no Supabase, and no auth in the path — the app's middleware gates every route
 * behind a Supabase session, so booting the whole stack just to look at a
 * document would couple this check to credentials it doesn't need.
 *
 *   npx tsx scripts/render-report.tsx
 *
 * Writes <repo>/../report-out/report.{html,pdf}. Open the PDF beside
 * Aaron_Alexander_Webinar_Strategy_Redesigned.pdf; any divergence is a renderer bug.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectBrowser } from "../lib/browser/connect";
import { aaronReport } from "../lib/report/fixtures/aaron";
import { buildReportHtml } from "../lib/report/renderer/html";

const OUT = join(process.cwd(), "..", "report-out");

/** Running head and page number. Chromium renders these in their own document,
 *  so our embedded fonts aren't available — hence the generic monospace stack. */
const headerTemplate = `
<div style="font-family:ui-monospace,'Courier New',monospace;font-size:7pt;width:100%;
            padding:0 18mm;display:flex;justify-content:space-between;letter-spacing:.12em;">
  <span style="color:#ef382b;font-weight:700;">CONVERSION BRANDS</span>
  <span style="color:#7a7068;">WEBINAR STRATEGY</span>
</div>`;

const footerTemplate = `
<div style="font-family:ui-monospace,'Courier New',monospace;font-size:7pt;width:100%;
            padding:0 18mm;display:flex;justify-content:space-between;color:#7a7068;">
  <span>Prepared by Conversion Brands · Planning document</span>
  <span class="pageNumber"></span>
</div>`;

async function main() {
  const content = aaronReport();
  const html = await buildReportHtml(content);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.html"), html);

  const { browser, context } = await connectBrowser({ headless: true });
  const page = await context.newPage();

  // setContent rather than a file:// navigation so the fonts (already inlined as
  // data URIs) resolve identically whether the browser is local or remote.
  await page.setContent(html, { waitUntil: "load" });
  // Belt and braces: font-display:block should make this a no-op, but a PDF that
  // silently falls back to Georgia is the failure mode most likely to slip past.
  await page.evaluate(() => document.fonts.ready);

  await page.pdf({
    path: join(OUT, "report.pdf"),
    format: "A4",
    // Margins come from here, not @page — Chromium ignores @page margin boxes,
    // and displayHeaderFooter needs this reserved space to draw into.
    margin: { top: "16mm", bottom: "14mm", left: "0", right: "0" },
    printBackground: true, // without this every tinted tile and callout renders white
    displayHeaderFooter: true,
    headerTemplate,
    footerTemplate,
  });

  await browser.close();

  const pages = await countPdfPages(join(OUT, "report.pdf"));
  console.log(`html  ${join(OUT, "report.html")}`);
  console.log(`pdf   ${join(OUT, "report.pdf")}  (${pages} pages)`);
  console.log(`\nsections rendered: ${content.sections.length}`);
}

/** Cheap page count — enough to compare against the reference's 12 pages. */
async function countPdfPages(path: string): Promise<number> {
  const buf = readFileSync(path);
  const matches = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
