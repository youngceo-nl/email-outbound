/*
 * Validation gates for a rendered report.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/validate-report.ts
 *
 * The gate definitions live in lib/report/gates.ts and also run inside the
 * live pipeline (loud notes on the report row). Here they gate a build:
 * exits non-zero on any failure.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildReport } from "../lib/report/build";
import { aaronReport } from "../lib/report/fixtures/aaron";
import { RICH_LEAD, SPARSE_LEAD } from "../lib/report/fixtures/leads";
import { GATES, visibleText } from "../lib/report/gates";
import { buildReportHtml } from "../lib/report/renderer/html";
import type { ReportContent } from "../lib/report/schema";

const OUT = join(process.cwd(), "..", "report-out");
const PREPARED_AT = new Date("2026-07-26T12:00:00Z");

async function main() {
  mkdirSync(OUT, { recursive: true });

  const subjects: Array<{ label: string; content: ReportContent }> = [
    { label: "aaron fixture", content: aaronReport() },
    { label: "rich lead", content: buildReport({ lead: RICH_LEAD, preparedAt: PREPARED_AT }).content },
    { label: "sparse lead", content: buildReport({ lead: SPARSE_LEAD, preparedAt: PREPARED_AT }).content },
  ];

  let failures = 0;

  for (const subject of subjects) {
    const html = await buildReportHtml(subject.content);
    writeFileSync(join(OUT, `validate-${subject.label.replace(/\s+/g, "-")}.html`), html);
    const text = visibleText(html);

    console.log(`
──── ${subject.label} ────`);
    for (const gate of GATES) {
      const hits = gate.check(text, subject.content);
      if (hits.length === 0) {
        console.log(`  PASS  ${gate.name}`);
      } else {
        failures += 1;
        console.log(`  FAIL  ${gate.name}`);
        for (const hit of hits.slice(0, 4)) console.log(`          ${hit}`);
        if (hits.length > 4) console.log(`          …and ${hits.length - 4} more`);
      }
    }
  }

  console.log(`
${failures === 0 ? "all gates passed" : `${failures} gate failure(s)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
