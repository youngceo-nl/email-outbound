/*
 * Phase 3 gate: a lead row in, a finished PDF out — the whole non-AI pipeline.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/render-lead-report.ts
 *
 * Renders both fixtures. The sparse one is the important output: it is the
 * data-poor prospect where nearly every input falls through to an assumption, and
 * it is what proves the document stays honest and presentable when the scrape
 * gave us almost nothing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectBrowser } from "../lib/browser/connect";
import { buildReport } from "../lib/report/build";
import { RICH_LEAD, SPARSE_LEAD } from "../lib/report/fixtures/leads";
import { fetchProspectImage } from "../lib/report/renderer/prospect-image";
import { buildReportHtml } from "../lib/report/renderer/html";
import type { Lead } from "../lib/types";

const OUT = join(process.cwd(), "..", "report-out");

/** Fixed so re-runs are byte-comparable. */
const PREPARED_AT = new Date("2026-07-25T12:00:00Z");

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
  mkdirSync(OUT, { recursive: true });
  const { browser, context } = await connectBrowser({ headless: true });

  for (const lead of [RICH_LEAD, SPARSE_LEAD] as Lead[]) {
    const { content, resolution, facts } = buildReport({ lead, preparedAt: PREPARED_AT });

    // Real fetch attempt: the fixtures carry no photo, so this exercises the
    // monogram path rather than pretending the happy path always happens.
    const photo = await fetchProspectImage(lead.profile_pic_url);
    const html = await buildReportHtml(content, { prospectPhoto: photo.ok ? photo.image.dataUri : null });

    const base = `lead-${lead.username.replace(/[^a-z0-9]/gi, "-")}`;
    writeFileSync(join(OUT, `${base}.html`), html);

    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: join(OUT, `${base}.pdf`),
      format: "A4",
      margin: { top: "16mm", bottom: "14mm", left: "0", right: "0" },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
    });
    await page.close();

    const tiers = resolution.resolved.reduce<Record<string, number>>((acc, r) => {
      acc[r.tier] = (acc[r.tier] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`\n@${lead.username}  ->  ${base}.pdf`);
    console.log(`  observed facts     ${facts.length}`);
    console.log(`  input tiers        ${Object.entries(tiers).map(([t, n]) => `${t}:${n}`).join("  ")}`);
    console.log(`  needs confirming   ${resolution.needsConfirmation.join(", ") || "none"}`);
    console.log(`  limitations        ${content.limitations.length}`);
    if (resolution.warnings.length) {
      for (const warning of resolution.warnings) console.log(`  ! ${warning}`);
    }
    console.log(`  photo              ${photo.ok ? "embedded" : `monogram (${photo.reason})`}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
