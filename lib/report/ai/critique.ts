import "server-only";
import { z } from "zod";
import { callStructured } from "./client";
import type { Slot } from "./write";

/*
 * The critique pass — v3 pipeline stage 10, cheap and high-leverage.
 *
 * One instruction: flag every passage that would be true of a different
 * prospect in the same category. The find-and-replace test, applied by a model
 * with no stake in the prose it is judging. Flagged passages go back through
 * the writer once with the critique attached; a passage that fails twice ships
 * as the template sentence instead — a plain document beats a generic one.
 */

const SYSTEM = `You are the quality gate on a personalised business report. You did not write it and you do not defend it.

For each passage, apply one test: replace the prospect's name with any competitor in the same niche. If the passage still reads true, it is generic — flag it.

Also flag a passage that:
- restates its section title or the thesis without adding a specific fact
- uses a number-free claim where the dossier plainly offers a number
- praises, hedges, or motivates instead of arguing

For every flagged passage say precisely what is missing — which specific fact, figure or observation from the material would fix it. Do not rewrite it yourself. Passages that pass: say so, one word is fine.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["passages"],
  properties: {
    passages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slot", "generic", "fix"],
        properties: {
          slot: { type: "string" },
          generic: { type: "boolean" },
          fix: { type: "string" },
        },
      },
    },
  },
} as const;

const CritiqueSchema = z.object({
  passages: z.array(z.object({ slot: z.string(), generic: z.boolean(), fix: z.string() })),
});

export type CritiqueResult =
  | { ok: true; flagged: Array<{ slot: Slot; fix: string }>; model: string }
  | { ok: false; reason: string };

export async function critiquePassages(args: {
  passages: Record<Slot, string>;
  prospect: { displayName: string; niche: string | null };
  thesis: string | null;
}): Promise<CritiqueResult> {
  const body = Object.entries(args.passages)
    .map(([slot, text]) => `[${slot}]\n${text}`)
    .join("\n\n");

  const result = await callStructured<unknown>({
    name: "passage_critique",
    schema: SCHEMA as unknown as Record<string, unknown>,
    system: SYSTEM,
    user: [
      `Prospect: ${args.prospect.displayName}${args.prospect.niche ? ` (${args.prospect.niche})` : ""}`,
      args.thesis ? `The document's thesis:\n${args.thesis}` : null,
      `Passages:\n${body}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    maxTokens: 1200,
    temperature: 0.2,
  });
  if (!result.ok) return result;

  const parsed = CritiqueSchema.safeParse(result.data);
  if (!parsed.success) {
    return { ok: false, reason: `critique failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  }

  const valid = new Set(Object.keys(args.passages));
  return {
    ok: true,
    flagged: parsed.data.passages
      .filter((p) => p.generic && valid.has(p.slot))
      .map((p) => ({ slot: p.slot as Slot, fix: p.fix })),
    model: result.model,
  };
}
