/*
 * Cited semantic extraction — Claude Haiku 4.5 as the primary extractor.
 *
 * Haiku receives a compressed evidence packet built from the stored snapshot and
 * returns structured facts with citations. It scores nothing and decides nothing.
 * Application code validates the response against the snapshot that was actually
 * inspected, then hands the facts to the deterministic rule engine.
 *
 * A malformed response gets exactly one structured repair attempt, then routes to
 * review. It never falls back to guessing a business model, because a guessed
 * model is indistinguishable from an evidenced one once it is stored.
 */

import { snapshotSourceIds } from "@/lib/evidence/collect";
import { EXTRACTION_PROMPT_VERSION } from "@/lib/evidence/versions";
import { collectCitations, validateCitationsResolve } from "./schemas";
import {
  adaptHaikuExtraction,
  EXTRACTION_JSON_SCHEMA,
  haikuExtractionSchema,
} from "./haiku-contract";
import { buildExtractionUserPrompt, EXTRACTION_SYSTEM_PROMPT } from "./prompt";
import { parseJsonLoose, type LlmClient } from "./providers";
import type { CommercialExtraction, EvidenceSnapshot } from "./types";

export type ExtractionSuccess = {
  ok: true;
  extraction: CommercialExtraction;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  repaired: boolean;
  citation_warnings: string[];
};

export type ExtractionFailure = {
  ok: false;
  reason: "ai_output_invalid" | "provider_error";
  problems: string[];
  provider: string | null;
  model: string | null;
  /** Failed attempts still cost tokens; they must show up in cost reporting. */
  usage: { inputTokens: number; outputTokens: number };
};

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

export async function extractCommercialEvidence(opts: {
  snapshot: EvidenceSnapshot;
  llm: LlmClient;
}): Promise<ExtractionResult> {
  const allowedSources = snapshotSourceIds(opts.snapshot);
  const userPrompt = buildExtractionUserPrompt(opts.snapshot, allowedSources);

  let provider: string | null = null;
  let model: string | null = null;
  let attemptProblems: string[] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nYour previous response was rejected by validation:\n${attemptProblems
            .map((problem) => `- ${problem}`)
            .join("\n")}\n\nReturn corrected JSON only. Cite only source ids from ALLOWED CITATION SOURCES. If you cannot cite a claim, return that signal as "unknown" rather than "present".`;

    let response;
    try {
      response = await opts.llm({
        system: EXTRACTION_SYSTEM_PROMPT,
        user: prompt,
        temperature: 0,
        maxTokens: 8000,
        jsonSchema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "commercial_evidence_extraction",
      });
    } catch (err) {
      return {
        ok: false,
        reason: "provider_error",
        problems: [err instanceof Error ? err.message : String(err)],
        provider,
        model,
        usage,
      };
    }

    provider = response.provider;
    model = response.model;
    usage = {
      inputTokens: usage.inputTokens + response.usage.inputTokens,
      outputTokens: usage.outputTokens + response.usage.outputTokens,
    };

    let raw: unknown;
    try {
      raw = parseJsonLoose(response.text);
    } catch (err) {
      attemptProblems = [err instanceof Error ? err.message : String(err)];
      continue;
    }

    const parsed = haikuExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      attemptProblems = parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      continue;
    }

    // Versions and the snapshot id are ours to assert, not the model's to choose.
    const extraction = adaptHaikuExtraction(
      parsed.data,
      opts.snapshot.snapshot_id,
      EXTRACTION_PROMPT_VERSION,
    );

    const citationProblems = validateCitationsResolve(extraction, allowedSources);
    if (citationProblems.length > 0) {
      attemptProblems = citationProblems;
      continue;
    }

    return {
      ok: true,
      extraction,
      provider: response.provider,
      model: response.model,
      usage,
      repaired: attempt > 0,
      citation_warnings: verifyPhrasesAppear(extraction, opts.snapshot),
    };
  }

  return {
    ok: false,
    reason: "ai_output_invalid",
    problems: attemptProblems,
    provider,
    model,
    usage,
  };
}

/*
 * Soft check that a cited phrase actually occurs in the snapshot text. Reported
 * as a warning rather than a hard failure because the spec permits faithful
 * normalization and translation, both of which legitimately change the
 * characters while preserving the meaning.
 */
function verifyPhrasesAppear(
  extraction: CommercialExtraction,
  snapshot: EvidenceSnapshot,
): string[] {
  const haystack = normalize(
    [
      snapshot.instagram.bio,
      snapshot.instagram.display_name,
      snapshot.instagram.category,
      snapshot.instagram.instagram_meta_description,
      ...snapshot.instagram.story_highlight_titles,
      ...snapshot.instagram.recent_posts.map((post) => post.caption ?? ""),
      ...snapshot.instagram.pinned_posts.map((post) => post.caption ?? ""),
      ...snapshot.external_destinations.flatMap((destination) => [
        destination.page_title ?? "",
        destination.meta_description ?? "",
        destination.text_excerpt ?? "",
        ...destination.headings,
        ...destination.offer_copy,
        ...destination.cta_labels.map((cta) => cta.label),
      ]),
      ...snapshot.youtube_channels.map((channel) => channel.description ?? ""),
      ...snapshot.youtube_channels.flatMap((channel) => channel.recent_video_titles),
      ...snapshot.youtube_videos.map((video) => `${video.title} ${video.description ?? ""}`),
    ].join(" \n "),
  );

  const warnings: string[] = [];
  for (const citation of collectCitations(extraction)) {
    const phrase = normalize(citation.phrase);
    if (phrase.length < 4) continue;
    if (!haystack.includes(phrase)) {
      warnings.push(
        `phrase not found verbatim in snapshot (${citation.source_type}:${citation.source_id}): "${citation.phrase.slice(0, 90)}"`,
      );
    }
    if (warnings.length >= 12) break;
  }
  return warnings;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}\s'"$%.,:/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
