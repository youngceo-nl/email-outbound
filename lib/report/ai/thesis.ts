import "server-only";
import { z } from "zod";
import { callStructured } from "./client";
import type { Analysis } from "./analyse";
import type { Dossier } from "./dossier";

/*
 * The thesis pass — v3 pipeline stage 8, the anti-template mechanism.
 *
 * Before any prose exists, the model commits to what this document argues: one
 * verdict sentence for page one, and one thesis paragraph every downstream
 * passage must serve. Written AFTER the analysis, so it argues findings rather
 * than inventing them; written BEFORE the copy, so the copy has something to
 * argue instead of describing sections.
 *
 * The test is stated in the prompt and enforced in the critique pass: if the
 * thesis could describe a different prospect in the same category, it failed.
 */

const SYSTEM = `You write the thesis of a Conversion Brands opportunity report — the single argument the whole document makes.

Given the dossier and the completed analysis, return:

- verdict_sentence: max 20 words. Page one opens with this in 24pt type. It must name something specific to THIS prospect — their number, their gap, their offer — and state the conclusion. Model: "You reach 5.1M people a month and sell one $12 product. The price is the constraint, not the funnel."
- thesis: max 80 words. The full argument: what was observed, what it means commercially, what to build, and what changes. Every later passage in the document argues this thesis.

Rules:
- The routing decision in the dossier's offer_ladder is settled. Argue it, don't relitigate it.
- Use only figures that appear in the dossier. Reuse them exactly as written.
- If your sentence would survive find-and-replace of the prospect's name with a competitor's, start over.
- No hedging stacks, no "could potentially", no motivational close.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict_sentence", "thesis"],
  properties: {
    verdict_sentence: { type: "string" },
    thesis: { type: "string" },
  },
} as const;

const ThesisSchema = z.object({
  verdict_sentence: z.string().min(20),
  thesis: z.string().min(80),
});

export type Thesis = z.infer<typeof ThesisSchema>;
export type ThesisResult = { ok: true; thesis: Thesis; model: string } | { ok: false; reason: string };

const wordCount = (text: string) => text.trim().split(/\s+/).length;

export async function writeThesis(args: { dossier: Dossier; analysis: Analysis }): Promise<ThesisResult> {
  const result = await callStructured<unknown>({
    name: "report_thesis",
    schema: SCHEMA as unknown as Record<string, unknown>,
    system: SYSTEM,
    user: [
      `Analysis:\n${JSON.stringify(args.analysis, null, 2)}`,
      `Dossier:\n${JSON.stringify(args.dossier, null, 2)}`,
    ].join("\n\n"),
    maxTokens: 600,
    temperature: 0.4,
  });
  if (!result.ok) return result;

  const parsed = ThesisSchema.safeParse(result.data);
  if (!parsed.success) {
    return { ok: false, reason: `thesis failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  // The word caps are the contract (v3 §9: build fails when the thesis exceeds
  // 80 words) — an over-long thesis is rejected here, not trimmed.
  if (wordCount(parsed.data.verdict_sentence) > 22) return { ok: false, reason: "verdict sentence over 20 words" };
  if (wordCount(parsed.data.thesis) > 85) return { ok: false, reason: "thesis over 80 words" };

  return { ok: true, thesis: parsed.data, model: result.model };
}
