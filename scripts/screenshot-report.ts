/*
 * Renders the fixture at A4 width and screenshots the cover plus every section
 * individually, so the design can actually be inspected.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/screenshot-report.ts
 *
 * Per-section shots rather than one very tall image: a full-page capture of a
 * 12-page document gets downscaled to the point where you can't tell whether the
 * display font loaded, which is the main thing being checked.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { connectBrowser } from "../lib/browser/connect";
import { buildReport } from "../lib/report/build";
import { aaronReport } from "../lib/report/fixtures/aaron";
import { RICH_LEAD, SPARSE_LEAD } from "../lib/report/fixtures/leads";
import { buildReportHtml } from "../lib/report/renderer/html";

/** A4 at 96dpi — the width the PDF is actually laid out at. */
const A4 = { width: 794, height: 1123 };

/** `npm run report:shots -- sparse` etc. Defaults to the reference fixture. */
const which = process.argv[2] ?? "aaron";
const OUT = join(process.cwd(), "..", "report-out", which === "aaron" ? "shots" : `shots-${which}`);
const PREPARED_AT = new Date("2026-07-25T12:00:00Z");

function contentFor(name: string) {
  if (name === "rich") return buildReport({ lead: RICH_LEAD, preparedAt: PREPARED_AT }).content;
  if (name === "sparse") return buildReport({ lead: SPARSE_LEAD, preparedAt: PREPARED_AT }).content;
  return aaronReport();
}

async function main() {
  const content = contentFor(which);
  const html = await buildReportHtml(content);

  mkdirSync(OUT, { recursive: true });

  const { browser, context } = await connectBrowser({
    headless: true,
    contextOptions: { viewport: A4, deviceScaleFactor: 2 },
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);

  // Confirm the embedded faces actually loaded rather than silently falling back.
  const fontCheck = await page.evaluate(() =>
    ["CB Funnel Display", "CB Inter", "CB Geist Mono"].map((f) => `${f}: ${document.fonts.check(`16px "${f}"`)}`),
  );
  console.log(fontCheck.join("\n"));

  const shots: string[] = [];
  const cover = page.locator(".cb-cover");
  if (await cover.count()) {
    await cover.screenshot({ path: join(OUT, "00-cover.png") });
    shots.push("00-cover.png");
  }

  const sections = content.sections.filter((s) => s.key !== "hero");
  for (const [i, section] of sections.entries()) {
    const el = page.locator(`#${section.key}`);
    if (!(await el.count())) continue;
    const name = `${String(i + 1).padStart(2, "0")}-${section.key}.png`;
    await el.screenshot({ path: join(OUT, name) });
    shots.push(name);
  }

  await browser.close();
  console.log(`\n${shots.length} shots -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
