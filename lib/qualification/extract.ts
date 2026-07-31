/*
 * Cited semantic extraction.
 *
 * The model is asked for facts with citations; application code validates them
 * against the snapshot that was actually inspected. A malformed response gets
 * exactly one structured repair attempt, then routes to review. It never falls
 * back to guessing a business model, because a guessed model is indistinguishable
 * from an evidenced one once it is stored.
 */

import { snapshotSourceIds } from "@/lib/evidence/collect";
import { EXTRACTION_PROMPT_VERSION } from "@/lib/evidence/versions";
import {
  commercialExtractionSchema,
  collectCitations,
  validateCitationsResolve,
} from "./schemas";
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
        : `${userPrompt}\n\nYour previous response was rejected by schema validation:\n${attemptProblems
            .map((problem) => `- ${problem}`)
            .join("\n")}\n\nReturn corrected JSON only. Do not add fields. Cite only allowed source ids.`;

    let response;
    try {
      response = await opts.llm({
        system: EXTRACTION_SYSTEM_PROMPT,
        user: prompt,
        temperature: 0.1,
      });
    } catch (err) {
      return {
        ok: false,
        reason: "provider_error",
        problems: [err instanceof Error ? err.message : String(err)],
        provider,
        model,
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

    // The prompt version is ours to assert, not the model's to choose.
    if (raw && typeof raw === "object") {
      (raw as Record<string, unknown>).extraction_prompt_version = EXTRACTION_PROMPT_VERSION;
      (raw as Record<string, unknown>).evidence_snapshot_id = opts.snapshot.snapshot_id;
    }

    const parsed = commercialExtractionSchema.safeParse(raw);
    if (!parsed.success) {
      attemptProblems = parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      continue;
    }

    const extraction = parsed.data as CommercialExtraction;
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
