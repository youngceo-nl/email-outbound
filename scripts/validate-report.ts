/*
 * Validation gates for a rendered report.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/validate-report.ts
 *
 * Implements the gates from the v2 spec §6. Runs against the rendered HTML rather
 * than the JSON, because that is what a prospect actually receives — a template
 * that drops a value still renders its surrounding sentence, and only the output
 * shows it.
 *
 * Exits non-zero on any failure so this can gate a build.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildReport } from "../lib/report/build";
import { aaronReport } from "../lib/report/fixtures/aaron";
import { RICH_LEAD, SPARSE_LEAD } from "../lib/report/fixtures/leads";
import { buildReportHtml } from "../lib/report/renderer/html";
import type { ReportContent } from "../lib/report/schema";

const OUT = join(process.cwd(), "..", "report-out");
const PREPARED_AT = new Date("2026-07-26T12:00:00Z");

type Gate = {
  name: string;
  /** Returns the offending excerpts. Empty means the gate passed. */
  check: (text: string, content: ReportContent) => string[];
};

/** Text content only — attribute values and CSS would produce false positives. */
function visibleText(html: string): string {
  const body = html.slice(html.indexOf("<body>"));
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/[ \t]+/g, " ");
}

const BANNED_PHRASES = [
  "in today's landscape",
  "in today's fast-paced",
  "it's important to note",
  "it is important to note",
  "that said",
  "at the end of the day",
  "by leveraging",
  "this allows you to",
  "the data tells a compelling story",
  "let's dive in",
  "now more than ever",
  "the possibilities are endless",
  "poised to",
  "stands at the forefront",
];

const BANNED_WORDS = [
  "leverage",
  "utilize",
  "robust",
  "seamless",
  "holistic",
  "comprehensive",
  "cutting-edge",
  "synergy",
  "ecosystem",
  "journey",
  "unlock",
  "elevate",
  "empower",
  "streamline",
  "delve",
  "tapestry",
  "realm",
];

const GATES: Gate[] = [
  {
    /*
     * The spec's highest-priority gate. A currency symbol with no digit after it
     * means a numeric interpolation returned empty and the sentence rendered
     * anyway — which is the single worst thing a prospect can receive.
     */
    name: "no currency symbol without a number",
    check: (text) => [...text.matchAll(/[$€£](?!\s*[\d—–-])/g)].map((m) => excerpt(text, m.index ?? 0)),
  },
  {
    name: "no empty Day/Days in the roadmap",
    // Not preceded by a digit-hyphen, so "21-Day Launch Roadmap" is left alone —
    // that is correct English. A roadmap row reading "Days " is the actual bug.
    check: (text) => [...text.matchAll(/(?<!\d-)\bDays?\s+(?![\d—–-])/g)].map((m) => excerpt(text, m.index ?? 0)),
  },
  {
    /*
     * Catches the general form of the same bug: "posts in the last  days",
     * "% of  observed followers". A doubled space inside a sentence is almost
     * always a dropped interpolation.
     */
    name: "no doubled space inside a sentence",
    check: (text) =>
      [...text.matchAll(/[a-z],?\s{2,}[a-z]/g)]
        .map((m) => excerpt(text, m.index ?? 0))
        .filter((e) => !/\s{2,}$/.test(e)),
  },
  {
    name: "no percentage sign without a number",
    check: (text) => [...text.matchAll(/(?<![\d.])%/g)].map((m) => excerpt(text, m.index ?? 0)),
  },
  {
    name: "the word 'assumption' appears at most 8 times",
    check: (text) => {
      const count = (text.toLowerCase().match(/assumption/g) ?? []).length;
      return count > 8 ? [`appears ${count} times`] : [];
    },
  },
  {
    name: "no banned phrases",
    check: (text) => {
      const lower = text.toLowerCase();
      return BANNED_PHRASES.filter((phrase) => lower.includes(phrase));
    },
  },
  {
    name: "no banned words",
    check: (text) => {
      const lower = text.toLowerCase();
      return BANNED_WORDS.filter((word) => new RegExp(`\\b${word}`, "i").test(lower));
    },
  },
  {
    /*
     * Merge-field smell. The spec's example was "Book consultation  Shmaiah
     * Gordon" repeated ten times — repetition of a long proper-noun offer name is
     * how a document announces it was filled in rather than written.
     */
    name: "offer name repeated at most 3 times",
    check: (text, content) => {
      const offer = content.sections
        .flatMap((s) => s.blocks)
        .flatMap((b) => (b.type === "table" ? b.rows.flat() : []))
        .find((cell) => cell.length > 12 && /[A-Z]/.test(cell[0]));
      if (!offer) return [];
      const occurrences = text.split(offer).length - 1;
      return occurrences > 3 ? [`"${offer}" appears ${occurrences} times`] : [];
    },
  },
  {
    name: "no possessive applied to a title",
    check: (text) => [...text.matchAll(/\b(Realtor|Coach|Consultant|Founder|CEO)[®™]?['’]s/gi)].map((m) => m[0]),
  },
];

function excerpt(text: string, index: number): string {
  return text.slice(Math.max(0, index - 45), index + 45).replace(/\s+/g, " ").trim();
}

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

    console.log(`\n──── ${subject.label} ────`);
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

  console.log(`\n${failures === 0 ? "all gates passed" : `${failures} gate failure(s)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
