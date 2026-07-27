import "server-only";
import { analyseProspect, type Analysis } from "./ai/analyse";
import { buildDossier } from "./ai/dossier";
import { SLOT_TO_SECTION, writePassages, type Slot } from "./ai/write";
import type { LadderResult } from "./build";
import type { Fact, InternalSignals } from "./facts";
import { count, pct, usd } from "./format";
import type { Lead } from "@/lib/types";
import type { ReportBlock, ReportContent, ScenarioSet, SectionKey } from "./schema";

/*
 * Two model passes, then a gate.
 *
 *   1. analyse  — reads the bio, every post caption with its engagement, the
 *                 offer page, the metrics, and commits to findings: does a
 *                 webinar fit, what is the real opportunity, what is missing.
 *   2. write    — argues those findings into seven sections of prose.
 *   3. validate — discards any passage containing a figure that does not already
 *                 exist in the fact set or the calculator's output.
 *
 * The gate is what makes it safe to let the model write this much. Numbers stay
 * computed; only the argument is generated. A model that invents "$47,000 in the
 * first 90 days" loses that passage and the template sentence stands — so the
 * failure mode is a duller document, never a false one.
 *
 * Every stage degrades independently. No API key, a rejected model, an analysis
 * that fails validation: each leaves a complete, honest, template-prose report
 * rather than no report.
 */

export type NarrativeResult = {
  content: ReportContent;
  /** Passages discarded, with why. Surfaced so a silent downgrade is visible. */
  rejected: Array<{ slot: string; reason: string }>;
  usedModel: boolean;
  /** Which model answered, for the record. */
  model?: string;
  analysis?: Analysis;
  /** Evidence ids the model cited that match no gathered fact. */
  unknownCitations: string[];
  /** Reviewer-facing, never rendered: conflicting evidence the analysis spotted. */
  contradictions: Analysis["contradictions"];
};

/**
 * Every figure the document already contains, normalised to bare digits.
 *
 * Normalising means the model may write "$27,106", "27,106" or "27106" and all
 * three match, while a figure that appears nowhere fails however it is formatted.
 */
function allowedNumbers(facts: Fact[], scenarios: ScenarioSet, content: ReportContent): Set<string> {
  const allowed = new Set<string>();
  const add = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return;
    for (const token of String(value).matchAll(/\d[\d,.]*/g)) {
      const bare = token[0].replace(/[,.]/g, "");
      allowed.add(bare);
      allowed.add(bare.replace(/0+$/, "") || "0");
    }
  };

  for (const fact of facts) add(fact.display);
  for (const assumption of content.assumptions) add(assumption.display);

  for (const scenario of Object.values(scenarios)) {
    for (const value of Object.values(scenario)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      // All three renderings, because a sentence may reasonably quote the same
      // quantity as money, a count or a percentage.
      add(usd(value));
      add(count(value));
      add(pct(value));
      add(String(Math.round(value)));
    }
  }

  // Structural numbers the template itself uses — a 21-day plan, an 8-stage
  // funnel, a 30/60/90 cadence. Ours, not claims about the prospect.
  for (const structural of ["1", "2", "3", "4", "5", "6", "8", "12", "21", "30", "60", "90"]) {
    allowed.add(structural);
  }

  return allowed;
}

/** Digit groups in a passage that match no known figure. */
function inventedNumbers(text: string, allowed: Set<string>): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\d[\d,.]*%?/g)) {
    const bare = match[0].replace(/%$/, "").replace(/[,.]/g, "");
    if (allowed.has(bare) || allowed.has(bare.replace(/0+$/, ""))) continue;
    found.push(match[0]);
  }
  return found;
}

/** Replaces the first paragraph in a section, or prepends one if it has none. */
function applyPassage(content: ReportContent, key: SectionKey, text: string): boolean {
  const section = content.sections.find((s) => s.key === key);
  if (!section) return false;
  const index = section.blocks.findIndex((block) => block.type === "paragraph");
  if (index >= 0) section.blocks[index] = { type: "paragraph", text };
  else section.blocks.unshift({ type: "paragraph", text });
  return true;
}

/**
 * Turns cited evidence ids into the human labels behind them.
 *
 * Unknown ids come back separately rather than being silently dropped: a claim
 * citing evidence we never gathered is exactly what the ids exist to catch, and it
 * should be visible rather than quietly rendering as an uncited assertion.
 */
function resolveCitations(ids: string[], facts: Fact[]): { labels: string[]; unknown: string[] } {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const labels: string[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const fact = byId.get(id);
    if (fact) labels.push(`${fact.label}: ${fact.display}`);
    else unknown.push(id);
  }
  return { labels, unknown };
}

/**
 * The analysis's own conclusions, as content the deterministic pass cannot produce:
 * the opportunity chain, the bottleneck, the fit verdict, the recommended event,
 * and what still needs validating.
 *
 * These carry no invented figures — they are judgements plus citations — so the
 * numeric gate has nothing to reject and they always survive.
 *
 * Contradictions are deliberately NOT rendered. The brief gives them a
 * reviewer_action, which makes them internal QA rather than something a prospect
 * should read; they go back to the caller instead.
 */
function applyAnalysisBlocks(content: ReportContent, analysis: Analysis, facts: Fact[]): string[] {
  const unknownCitations: string[] = [];
  const cite = (ids: string[]) => {
    const { labels, unknown } = resolveCitations(ids, facts);
    unknownCitations.push(...unknown);
    return labels;
  };

  // The opportunity chain exactly as the brief specifies it: observation, meaning,
  // action, effect. It sits in the verdict because it is the report's argument.
  const verdict = content.sections.find((s) => s.key === "verdict");
  if (verdict) {
    const opp = analysis.primary_opportunity;
    const basis = cite(opp.evidence_ids);
    verdict.blocks.push({
      type: "table",
      variant: "default",
      emphasizeColumn: null,
      columns: ["The opportunity", "Detail"],
      rows: [
        ["What we observed", opp.observation],
        ["What it means commercially", opp.business_meaning],
        ["What we recommend", opp.recommended_action],
        ["What it is meant to change", opp.expected_effect],
        ...(basis.length > 0 ? [["Based on", basis.join("; ")]] : []),
        ["Confidence", opp.confidence],
      ],
    });

    const tone = analysis.fit_verdict === "poor" ? "risk" : analysis.fit_verdict === "strong" ? "good" : "note";
    verdict.blocks.push({
      type: "callout",
      tone,
      title:
        analysis.fit_verdict === "poor"
          ? "Where this model does not fit"
          : analysis.fit_verdict === "strong"
            ? "Why this fits"
            : "Workable, with conditions",
      text: analysis.fit_reasoning,
    });
  }

  const assets = content.sections.find((s) => s.key === "assets");
  if (assets) {
    if (analysis.strongest_assets.length > 0) {
      assets.blocks.push({
        type: "table",
        variant: "default",
        emphasizeColumn: null,
        columns: ["Strongest assets", "What that rests on"],
        rows: analysis.strongest_assets.map((a) => [a.statement, cite(a.evidence_ids).join("; ") || "Interpretation"]),
      });
    }
    if (analysis.offer_gaps.length > 0) {
      assets.blocks.push({
        type: "callout",
        tone: "note",
        title: "Gaps in the current offer ladder",
        text: analysis.offer_gaps.join(" "),
      });
    }
  }

  const positioning = content.sections.find((s) => s.key === "positioning");
  if (positioning) {
    const event = analysis.recommended_event;
    positioning.blocks.push({ type: "callout", tone: "good", title: event.title, text: event.promise });
    if (event.pillars.length > 0) {
      positioning.blocks.push({
        type: "table",
        variant: "default",
        emphasizeColumn: null,
        columns: ["Event structure", "What it covers"],
        rows: [...event.pillars.map((pillar, i) => [`Pillar ${i + 1}`, pillar]), ["Call to action", event.cta]],
      });
    }
  }

  // Findings sit next to the measurement they came from, which is the whole point.
  const contentSection = content.sections.find((s) => s.key === "content");
  if (contentSection && analysis.content_findings.length > 0) {
    contentSection.blocks.push({
      type: "table",
      variant: "default",
      emphasizeColumn: null,
      columns: ["Observation", "What it rests on"],
      rows: analysis.content_findings.map((f) => [f.statement, cite(f.evidence_ids).join("; ") || "Interpretation"]),
    });
  }

  const funnel = content.sections.find((s) => s.key === "funnel");
  if (funnel) {
    funnel.blocks.push({
      type: "callout",
      tone: "risk",
      title: "The bottleneck",
      text: `${analysis.bottleneck.statement} ${analysis.bottleneck.why_it_matters}`,
    });
    if (analysis.funnel_diagnosis.exists.length || analysis.funnel_diagnosis.missing.length) {
      funnel.blocks.push({
        type: "table",
        variant: "default",
        emphasizeColumn: null,
        columns: ["Funnel component", "Status"],
        rows: [
          ...analysis.funnel_diagnosis.exists.map((item) => [item, "Already in place"]),
          ...analysis.funnel_diagnosis.missing.map((item) => [item, "Would need building"]),
        ],
      });
    }
  }

  // Which assumption most moves the outcome. The brief asks for this explicitly,
  // and it is the honest counterweight to a table of projections.
  const pnl = content.sections.find((s) => s.key === "pnl");
  if (pnl) {
    pnl.blocks.push({
      type: "callout",
      tone: "note",
      title: "The assumption that matters most",
      text: analysis.most_sensitive_assumption,
    });
  }

  const decision = content.sections.find((s) => s.key === "decision");
  if (decision) {
    if (analysis.risks.length > 0) {
      decision.blocks.unshift({
        type: "callout",
        tone: "risk",
        title: "What would put this launch at risk",
        text: analysis.risks.join(" "),
      });
    }
    // "What must be validated" is in the required flow, and stating it is what
    // separates a diagnosis from a pitch.
    if (analysis.missing_information.length > 0) {
      decision.blocks.push({
        type: "table",
        variant: "default",
        emphasizeColumn: null,
        columns: ["Still to confirm", "Why it matters", "How to resolve it"],
        rows: analysis.missing_information.map((m) => [m.item, m.why_it_matters, m.recommended_resolution]),
      });
    }
  }

  return unknownCitations;
}

/*
 * The viability gate, deterministic and unskippable: a projected case that loses
 * money can never be presented as a strong fit. The old generator shipped a
 * -$5,278 net beside a "proceed" recommendation — the model wrote confidently
 * about a launch its own numbers said would fail. The model still writes the
 * reasoning; what it may not do is contradict the arithmetic.
 */
function enforceViability(analysis: Analysis, ladder: LadderResult): void {
  if (ladder.viable) return;
  if (analysis.fit_verdict === "strong") analysis.fit_verdict = "workable";
  const preface =
    ladder.decision.route === "repricing" || ladder.decision.route === "missing_mid"
      ? "At the price observed today the projected case loses money; the launch case rests on the mid-ticket offer, not on running the current numbers."
      : "The projected case is negative at the modelled inputs, so this cannot be read as a proceed recommendation.";
  if (!analysis.fit_reasoning.startsWith(preface)) {
    analysis.fit_reasoning = `${preface} ${analysis.fit_reasoning}`;
  }
}

export async function generateNarrativeDetailed(args: {
  lead: Lead;
  content: ReportContent;
  facts: Fact[];
  signals: InternalSignals;
  scenarios: ScenarioSet;
  /** From buildReport(). Optional so older callers keep working; without it the
   *  viability gate and ladder context are simply absent, as before. */
  ladder?: LadderResult;
}): Promise<NarrativeResult> {
  const dossier = buildDossier({
    lead: args.lead,
    facts: args.facts,
    scenarios: args.scenarios,
    assumptions: args.content.assumptions,
    limitations: args.content.limitations,
    offerLadder: args.ladder?.summary ?? null,
  });

  const analysed = await analyseProspect(dossier);
  if (analysed.ok && args.ladder) enforceViability(analysed.analysis, args.ladder);
  if (!analysed.ok) {
    // A complete template report is a valid outcome. The document says what it
    // knows and what it assumed either way.
    return {
      content: args.content,
      rejected: [{ slot: "analysis", reason: analysed.reason }],
      usedModel: false,
      unknownCitations: [],
      contradictions: [],
    };
  }

  const written = await writePassages({ dossier, analysis: analysed.analysis });
  if (!written.ok) {
    // The analysis is still worth having even if the prose pass failed — its
    // verdict, risks and recommended event carry no figures and stand alone.
    const unknown = applyAnalysisBlocks(args.content, analysed.analysis, args.facts);
    return {
      content: args.content,
      rejected: [{ slot: "passages", reason: written.reason }],
      usedModel: true,
      model: analysed.model,
      analysis: analysed.analysis,
      unknownCitations: unknown,
      contradictions: analysed.analysis.contradictions,
    };
  }

  const allowed = allowedNumbers(args.facts, args.scenarios, args.content);
  const rejected: NarrativeResult["rejected"] = [];

  for (const [slot, sectionKey] of Object.entries(SLOT_TO_SECTION) as Array<[Slot, SectionKey]>) {
    const passage = written.passages[slot];
    const invented = inventedNumbers(passage, allowed);
    if (invented.length > 0) {
      // The template sentence stays. A fabricated figure in front of a prospect
      // is the single failure this whole design exists to prevent.
      rejected.push({ slot, reason: `invented figures: ${invented.join(", ")}` });
      continue;
    }
    if (!applyPassage(args.content, sectionKey, passage)) {
      rejected.push({ slot, reason: `no ${sectionKey} section in this report` });
    }
  }

  const unknownCitations = applyAnalysisBlocks(args.content, analysed.analysis, args.facts);

  return {
    content: args.content,
    rejected,
    usedModel: true,
    model: written.model,
    analysis: analysed.analysis,
    unknownCitations,
    contradictions: analysed.analysis.contradictions,
  };
}

/** Convenience wrapper for callers that only want the document. */
export async function generateNarrative(args: {
  lead: Lead;
  content: ReportContent;
  facts: Fact[];
  signals: InternalSignals;
  scenarios: ScenarioSet;
}): Promise<ReportContent> {
  const result = await generateNarrativeDetailed(args);
  if (result.unknownCitations.length > 0) {
    // Cited evidence that does not exist is a model error worth seeing, even though
    // the claim still renders as an interpretation rather than as a fact.
    console.warn(`[narrative] unresolved evidence citations: ${result.unknownCitations.join(", ")}`);
  }
  if (result.contradictions.length > 0) {
    console.warn(
      `[narrative] ${result.contradictions.length} contradiction(s) for review:`,
      result.contradictions.map((c) => c.description).join("; "),
    );
  }
  if (result.rejected.length > 0) {
    console.warn(
      `[narrative] kept template prose for ${result.rejected.length} passage(s):`,
      result.rejected.map((r) => `${r.slot} (${r.reason})`).join("; "),
    );
  }
  return result.content;
}

/** Re-exported so callers can type against the block union without a deep import. */
export type { ReportBlock };
