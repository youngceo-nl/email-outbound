import type { ReportContent } from "./schema";

/*
 * Validation gates — v3 §6/§9, shared between the dev script and the live
 * pipeline. They run against the rendered HTML rather than the JSON, because
 * that is what a prospect receives: a template that drops a value still renders
 * its surrounding sentence, and only the output shows it.
 *
 * In the pipeline a failure is a loud note on the report row; in the script it
 * fails the build. Same checks either way, one definition.
 */

export type GateFailure = { name: string; excerpts: string[] };

type Gate = {
  name: string;
  /** Returns the offending excerpts. Empty means the gate passed. */
  check: (text: string, content: ReportContent | null) => string[];
};

/** Text content only — attribute values and CSS would produce false positives. */
export function visibleText(html: string): string {
  const body = html.slice(html.indexOf("<body"));
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
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

function excerpt(text: string, index: number): string {
  return text.slice(Math.max(0, index - 45), index + 45).replace(/\s+/g, " ").trim();
}

export const GATES: Gate[] = [
  {
    // The highest-priority gate: a currency symbol with no digit after it means
    // a numeric interpolation returned empty and the sentence rendered anyway.
    name: "no currency symbol without a number",
    check: (text) => [...text.matchAll(/[$€£](?!\s*[\d—–-])/g)].map((m) => excerpt(text, m.index ?? 0)),
  },
  {
    name: "no empty Day/Days in the roadmap",
    check: (text) => [...text.matchAll(/(?<!\d[-–])\bDays?\s+(?![\d—–-])/g)].map((m) => excerpt(text, m.index ?? 0)),
  },
  {
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
      const found = (text.toLowerCase().match(/assumption/g) ?? []).length;
      return found > 8 ? [`appears ${found} times`] : [];
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
    name: "no possessive applied to a title",
    check: (text) => [...text.matchAll(/\b(Realtor|Coach|Consultant|Founder|CEO)[®™]?['’]s/gi)].map((m) => m[0]),
  },
];

/** Runs every gate against rendered HTML. Empty result = all gates passed. */
export function runGates(html: string, content: ReportContent | null = null): GateFailure[] {
  const text = visibleText(html);
  const failures: GateFailure[] = [];
  for (const gate of GATES) {
    const excerpts = gate.check(text, content);
    if (excerpts.length > 0) failures.push({ name: gate.name, excerpts: excerpts.slice(0, 3) });
  }
  return failures;
}
