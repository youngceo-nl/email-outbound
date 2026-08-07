/*
 * Visual-identity pass — Claude Haiku 4.5 with vision, for Gate 2 ("the
 * Instagram profile must primarily represent an identifiable individual whose
 * identity is central to the business").
 *
 * The evidence snapshot is otherwise 100% text, so a brand-named, creator-led
 * account and a faceless theme page read identically to the text extractor.
 * This pass looks at the stored profile picture and a handful of post
 * thumbnails and answers ONLY: is a person shown, and is it the same person
 * repeatedly. It never decides whether Gate 2 passes — same rule as
 * extract.ts and challenger.ts, deterministic code makes that call.
 *
 * An unparseable or failed vision call is an UNKNOWN, never an absence. A
 * profile with zero stored images (download failed, no bio-worthy pictures,
 * an older snapshot acquired before this pass existed) must not be able to
 * fail Gate 2 on that basis — it routes to uncertain, which is manual review,
 * not rejection.
 */

import { z } from "zod";
import { downloadLeadImage } from "@/lib/instagram/profile-images";
import { VISION_PROMPT_VERSION } from "@/lib/evidence/versions";
import { parseJsonLoose, type LlmClient, type LlmImageInput } from "./providers";
import type { EvidenceCitation, EvidenceSnapshot, SignalState, StoredImage } from "./types";

export const VISUAL_IDENTITY_SYSTEM_PROMPT = `You inspect Instagram profile and post images for an outreach qualification
system. You answer ONLY whether an identifiable individual is shown and
whether the same individual recurs across images. You do not decide whether
the account qualifies, and you do not describe or identify who the person is
beyond that they are a recurring individual.

TASK
For each image, note whether a human individual is clearly visible (not a
logo, a product photo, a screenshot, a graphic, or stock/generic imagery).
Then judge whether the images that DO show a person show the SAME person
repeatedly, which is the signal that this is a personal brand rather than a
theme page, meme page, or repost account borrowing photos.

STATES
individual_visible and recurring_individual each use:
- present: cited evidence supports it
- absent: the images WERE inspected and do not support it
- unknown: the images could not be meaningfully inspected (blank, corrupted,
  too small, or otherwise unreadable)

Do not guess. If you are not confident a person recurs across images, prefer
"unknown" over "present" — a false "present" wrongly passes a theme page, and
a false "absent" wrongly rejects a real coach whose thumbnails happen to be
mostly text-overlay slides.

OUTPUT
Return only JSON matching the required schema. Every non-"unknown" state
requires at least one evidence entry citing an image you actually inspected,
using its exact source_id from the provided image list.`;

const VISUAL_IDENTITY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "individual_visible",
    "recurring_individual",
    "images_with_person",
    "images_examined",
    "appears_faceless_or_stock",
    "notes",
    "evidence",
  ],
  properties: {
    individual_visible: { type: "string", enum: ["present", "absent", "unknown"] },
    recurring_individual: { type: "string", enum: ["present", "absent", "unknown"] },
    // `minimum` is rejected by Anthropic's structured-output compiler ("For
    // 'integer' type, property 'minimum' is not supported") — confirmed live
    // 2026-08-06. Non-negativity is still enforced by the Zod re-validation
    // below, same division of labor as everywhere else in this pipeline.
    images_with_person: { type: "integer" },
    images_examined: { type: "integer" },
    appears_faceless_or_stock: { type: "boolean" },
    notes: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source_type", "source_id", "phrase"],
        properties: {
          source_type: { type: "string", enum: ["profile_image", "post_image"] },
          source_id: { type: "string" },
          phrase: { type: "string" },
        },
      },
    },
  },
} as const;

const visualIdentityZodSchema = z
  .object({
    individual_visible: z.enum(["present", "absent", "unknown"]),
    recurring_individual: z.enum(["present", "absent", "unknown"]),
    images_with_person: z.number().int().min(0).default(0),
    images_examined: z.number().int().min(0).default(0),
    appears_faceless_or_stock: z.boolean().default(false),
    notes: z.string().default(""),
    evidence: z
      .array(
        z
          .object({
            source_type: z.enum(["profile_image", "post_image"]),
            source_id: z.string().min(1),
            phrase: z.string().default(""),
          })
          .strict(),
      )
      .default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const field of ["individual_visible", "recurring_individual"] as const) {
      if (value[field] !== "unknown" && value.evidence.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field} is "${value[field]}" but no image evidence was cited`,
          path: ["evidence"],
        });
      }
    }
  });

export type VisualIdentityFacts = z.infer<typeof visualIdentityZodSchema>;

export type VisualIdentityResult =
  | {
      ok: true;
      /** null when no images were available to inspect — never call the model on zero images. */
      facts: VisualIdentityFacts | null;
      vision_prompt_version: string;
      provider: string | null;
      model: string | null;
      usage: { inputTokens: number; outputTokens: number };
      repaired: boolean;
    }
  | {
      ok: false;
      reason: "ai_output_invalid" | "provider_error";
      problems: string[];
      provider: string | null;
      model: string | null;
      usage: { inputTokens: number; outputTokens: number };
    };

const MEDIA_TYPE_BY_EXT: Record<string, LlmImageInput["mediaType"]> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function mediaTypeForPath(path: string): LlmImageInput["mediaType"] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPE_BY_EXT[ext] ?? "image/jpeg";
}

export async function runVisualIdentity(opts: {
  snapshot: EvidenceSnapshot;
  llm: LlmClient;
  /** Caps how many images are actually sent to the model — profile pic plus up to 9 posts by default. */
  maxImages?: number;
}): Promise<VisualIdentityResult> {
  const captured = (opts.snapshot.visual_evidence?.images ?? []).filter(
    (image): image is StoredImage & { storage_path: string } =>
      image.capture_status === "captured" && Boolean(image.storage_path),
  );

  if (captured.length === 0) {
    return {
      ok: true,
      facts: null,
      vision_prompt_version: VISION_PROMPT_VERSION,
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      repaired: false,
    };
  }

  const images = captured.slice(0, opts.maxImages ?? 10);
  const downloaded: LlmImageInput[] = [];
  const imageManifest: Array<{ source_id: string; source_type: string }> = [];

  for (const image of images) {
    const bytes = await downloadLeadImage(image.storage_path);
    if (!bytes) continue;
    downloaded.push({
      sourceId: image.source_id,
      mediaType: mediaTypeForPath(image.storage_path) ?? (bytes.contentType as LlmImageInput["mediaType"]),
      base64Data: bytes.buffer.toString("base64"),
    });
    imageManifest.push({ source_id: image.source_id, source_type: image.source_type });
  }

  if (downloaded.length === 0) {
    // Every stored path failed to download — same as "no images", not an absence.
    return {
      ok: true,
      facts: null,
      vision_prompt_version: VISION_PROMPT_VERSION,
      provider: null,
      model: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      repaired: false,
    };
  }

  const userPrompt = `Inspect the attached images for @${opts.snapshot.username} in order.

IMAGE LIST (in the order attached)
${JSON.stringify(imageManifest)}

Cite each image you draw a conclusion from using its exact source_id and
source_type from this list. Return the required JSON only.`;

  let provider: string | null = null;
  let model: string | null = null;
  let usage = { inputTokens: 0, outputTokens: 0 };
  let problems: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const repairNote =
      attempt === 0
        ? ""
        : `\n\nYour previous response was rejected by validation:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nReturn corrected JSON only.`;

    let response;
    try {
      response = await opts.llm({
        system: VISUAL_IDENTITY_SYSTEM_PROMPT,
        user: `${userPrompt}${repairNote}`,
        temperature: 0,
        maxTokens: 1200,
        jsonSchema: VISUAL_IDENTITY_JSON_SCHEMA,
        images: downloaded,
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
      problems = [err instanceof Error ? err.message : String(err)];
      continue;
    }

    const parsed = visualIdentityZodSchema.safeParse(raw);
    if (!parsed.success) {
      problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      continue;
    }

    // Citations must resolve against images we actually attached.
    const knownIds = new Set(imageManifest.map((entry) => `${entry.source_type}:${entry.source_id}`));
    const unresolved = parsed.data.evidence.filter(
      (e) => !knownIds.has(`${e.source_type}:${e.source_id}`),
    );
    if (unresolved.length > 0) {
      problems = unresolved.map((e) => `evidence cites unattached image ${e.source_type}:${e.source_id}`);
      continue;
    }

    return {
      ok: true,
      facts: parsed.data,
      vision_prompt_version: VISION_PROMPT_VERSION,
      provider,
      model,
      usage,
      repaired: attempt > 0,
    };
  }

  return { ok: false, reason: "ai_output_invalid", problems, provider, model, usage };
}

/*
 * Turns the vision facts into a Gate-2-shaped signal, WITHOUT deciding the
 * gate — decide.ts (or its follow-up-plan successor) does that. This is the
 * same present/absent/unknown/conflicting vocabulary every other signal in
 * the pipeline uses, so Gate 2 composes with the existing core-gate logic
 * instead of needing a special case.
 */
export function visualIdentitySignalState(facts: VisualIdentityFacts | null): SignalState {
  if (!facts) return "unknown";
  if (facts.individual_visible === "unknown" || facts.recurring_individual === "unknown") return "unknown";
  if (facts.individual_visible === "absent") return "absent";
  if (facts.recurring_individual === "present") return "present";
  // A person is visible somewhere but not established as recurring — genuinely ambiguous.
  return "conflicting";
}

export function visualIdentityEvidence(facts: VisualIdentityFacts | null): EvidenceCitation[] {
  if (!facts) return [];
  return facts.evidence.map((e) => ({
    source_type: e.source_type,
    source_id: e.source_id,
    url: null,
    field: "image",
    phrase: e.phrase,
  }));
}
