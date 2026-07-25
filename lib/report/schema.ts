import { z } from "zod";
import type { ScenarioOutputs } from "./calculations/formulas";

/**
 * The report document contract: what generation produces and the renderer
 * consumes. One schema keeps those two in lockstep instead of a bespoke shape
 * per section.
 *
 * Adapted from report-generator's packages/contracts (report-blocks.ts +
 * report.ts) with its multi-tenant scaffolding dropped — there are no
 * workspaces, projects or claim UUIDs here, just a lead. Two block types are
 * added because the reference document can't be reproduced without them: the
 * reference is full of two- and three-column tables (§0 inputs, §2 asset
 * readiness, §6 P&L, §7 revenue view, §10 sources) and tinted callouts, neither
 * of which the ported block set had.
 *
 * Convention carried over deliberately: optional values are `.nullable()`, not
 * `.optional()`. Strict structured-output modes require every field present in
 * `required`, so "absent" has to be expressible as null. Keeping it now means
 * the same schema can be handed to the model in Phase 5 unchanged.
 */

/**
 * Section order. `content` is an addition to the reference's set, not part of it:
 * the scrape captures the last ~12 posts per lead and nothing was reading them,
 * so the report said nothing about how their content actually performs.
 *
 * Sections are numbered by position at render time rather than from a fixed map,
 * so a report that omits one (a lead with no post data has no content section)
 * still numbers 0..N contiguously instead of skipping a heading.
 */
export const SECTION_KEYS = [
  "hero",
  "overview",
  "verdict",
  "assets",
  "positioning",
  "content",
  "funnel",
  "opportunity",
  "pnl",
  "backend",
  "proof",
  "roadmap",
  "decision",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * Where a value came from. Printed next to figures and rolled up into §0's
 * known-limits list and §10's source notes, so a reader can always separate an
 * observation from a working assumption. Ordered by precedence: a human
 * override beats a scrape, which beats a category benchmark, which beats the
 * fallback ladder.
 */
export const TIERS = ["human", "observed", "researched", "assumed"] as const;
export const TierSchema = z.enum(TIERS);
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = {
  human: "Confirmed",
  observed: "Observed",
  researched: "Benchmark",
  assumed: "Assumption",
};

// ── blocks ──────────────────────────────────────────────────────────────────

export const StatSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  sublabel: z.string().nullable(),
});

export const ParagraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string().min(1),
});

export const StatGridBlockSchema = z.object({
  type: z.literal("stat_grid"),
  stats: z.array(StatSchema).min(1),
});

export const TableBlockSchema = z.object({
  type: z.literal("table"),
  columns: z.array(z.string().min(1)).min(2),
  rows: z.array(z.array(z.string())).min(1),
  /** "figures" right-aligns and monospaces every column but the first. */
  variant: z.enum(["default", "figures"]).nullable(),
  /** 0-indexed column to wash in accent — the scenario being argued for. */
  emphasizeColumn: z.number().int().nonnegative().nullable(),
});

export const CalloutBlockSchema = z.object({
  type: z.literal("callout"),
  /** risk = qualifier or exposure, note = how to read it, good = recommendation. */
  tone: z.enum(["neutral", "risk", "note", "good"]),
  title: z.string().min(1),
  text: z.string().min(1),
});

export const LadderBlockSchema = z.object({
  type: z.literal("ladder"),
  steps: z
    .array(z.object({ price: z.string().min(1), name: z.string().min(1), role: z.string().min(1) }))
    .min(2),
});

export const StepListBlockSchema = z.object({
  type: z.literal("step_list"),
  steps: z
    .array(
      z.object({
        order: z.number().int().positive(),
        title: z.string().min(1),
        description: z.string().min(1),
        meta: z.string().nullable(),
      }),
    )
    .min(1),
});

export const QuestionListBlockSchema = z.object({
  type: z.literal("question_list"),
  questions: z.array(z.object({ order: z.number().int().positive(), question: z.string().min(1) })).min(1),
});

export const CaseStudyBlockSchema = z.object({
  type: z.literal("case_study"),
  label: z.string().min(1),
  headline: z.string().min(1),
  metrics: z.array(StatSchema).min(1),
});

export const ReportBlockSchema = z.discriminatedUnion("type", [
  ParagraphBlockSchema,
  StatGridBlockSchema,
  TableBlockSchema,
  CalloutBlockSchema,
  LadderBlockSchema,
  StepListBlockSchema,
  QuestionListBlockSchema,
  CaseStudyBlockSchema,
]);

export type Stat = z.infer<typeof StatSchema>;
export type ReportBlock = z.infer<typeof ReportBlockSchema>;
export type ParagraphBlock = z.infer<typeof ParagraphBlockSchema>;
export type StatGridBlock = z.infer<typeof StatGridBlockSchema>;
export type TableBlock = z.infer<typeof TableBlockSchema>;
export type CalloutBlock = z.infer<typeof CalloutBlockSchema>;
export type LadderBlock = z.infer<typeof LadderBlockSchema>;
export type StepListBlock = z.infer<typeof StepListBlockSchema>;
export type QuestionListBlock = z.infer<typeof QuestionListBlockSchema>;
export type CaseStudyBlock = z.infer<typeof CaseStudyBlockSchema>;

// ── document ────────────────────────────────────────────────────────────────

export const ResolvedAssumptionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  /** Already formatted for print ("$2,000", "25%") — the renderer never formats inputs. */
  display: z.string().min(1),
  tier: TierSchema,
  /** Human-readable provenance, e.g. "their Skool page, 25 Jul 2026". */
  source: z.string().min(1),
});
export type ResolvedAssumption = z.infer<typeof ResolvedAssumptionSchema>;

export const SourceNoteSchema = z.object({
  source: z.string().min(1),
  usedFor: z.string().min(1),
});
export type SourceNote = z.infer<typeof SourceNoteSchema>;

export const ReportSectionSchema = z.object({
  key: z.enum(SECTION_KEYS),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  blocks: z.array(ReportBlockSchema),
});

export const ReportContentSchema = z.object({
  schemaVersion: z.string().min(1),
  metadata: z.object({
    leadId: z.string().nullable(),
    username: z.string().min(1),
    /** Falls back to username when a lead has no full_name. */
    displayName: z.string().min(1),
    /** Pre-formatted ("191K") for the cover card. Null when unknown. */
    followersDisplay: z.string().nullable(),
    verified: z.boolean(),
    reportTitle: z.string().min(1),
    /** The one-line argument under the title on the cover. */
    thesis: z.string().min(1),
    purpose: z.string().min(1),
    preparedAt: z.string().min(1),
    /** When the underlying scrape was taken — printed so figures are always dated. */
    evidenceCutoffAt: z.string().min(1),
  }),
  sections: z.array(ReportSectionSchema).min(1),
  assumptions: z.array(ResolvedAssumptionSchema),
  limitations: z.array(z.string().min(1)),
  sourceNotes: z.array(SourceNoteSchema),
});
export type ReportContent = z.infer<typeof ReportContentSchema>;

/**
 * Render-time assets, deliberately *not* part of ReportContent.
 *
 * Both are large base64 blobs. ReportContent gets persisted as JSON per report,
 * so carrying a photo and a logo inside it would bloat every stored row for
 * something that is regenerated on every render anyway.
 */
export type ReportAssets = {
  logoMark: string;
  /** Data URI, or null to fall back to the monogram. */
  prospectPhoto: string | null;
};

/**
 * Scenario set, keyed to the calculator's two columns.
 *
 * The reference report showed three (conservative / expected / strong), but the
 * calculator the team actually runs a P&L in has a projected case and a worst-case
 * CPL stress test, differing only in cost per lead. Matching the tool wins: it
 * means a report and the spreadsheet behind it can never disagree.
 */
export type ScenarioSet = {
  projected: ScenarioOutputs;
  worst: ScenarioOutputs;
};
