import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import type { AiClassification } from "@/lib/scoring/types";
import type { ScrapedProfile } from "@/lib/types";

const SYSTEM = `You are classifying an Instagram creator/business account for a B2B outbound team.
Output STRICT JSON. Be decisive — pick the best bucket even when info is partial.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["niche", "business_model", "offer_type", "audience_type", "has_visible_offer", "offer_confidence"],
  properties: {
    niche:              { type: "string" },
    business_model:     { type: "string", enum: ["course", "coaching", "agency", "ecom", "saas", "creator", "unknown"] },
    offer_type:         { type: "string" },
    audience_type:      { type: "string" },
    has_visible_offer:  { type: "boolean" },
    offer_confidence:   { type: "string", enum: ["high", "medium", "low", "none"] },
  },
} as const;

const Parsed = z.object({
  niche: z.string(),
  business_model: z.enum(["course", "coaching", "agency", "ecom", "saas", "creator", "unknown"]),
  offer_type: z.string(),
  audience_type: z.string(),
  has_visible_offer: z.boolean(),
  offer_confidence: z.enum(["high", "medium", "low", "none"]),
});

export async function classifyWithOpenAi(opts: {
  apiKey: string;
  model: string;
  profile: ScrapedProfile;
}): Promise<{ classification: AiClassification; usage: { inputTokens: number; outputTokens: number } }> {
  const openai = new OpenAI({ apiKey: opts.apiKey });
  const captions = (opts.profile.recent_posts || [])
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${(p.caption ?? "").slice(0, 240)}`)
    .join("\n");

  const userPrompt = `Classify this Instagram account.

PROFILE
- username: @${opts.profile.username}
- full_name: ${opts.profile.full_name ?? ""}
- bio: ${opts.profile.bio ?? ""}
- external_link: ${opts.profile.external_link ?? "(none)"}

RECENT CAPTIONS
${captions || "(none)"}

Fields to return:
- niche: short phrase like "fitness coaching", "b2b saas", "beauty ecom"
- business_model: one of course/coaching/agency/ecom/saas/creator/unknown
- offer_type: brief, e.g. "$497 course", "free lead magnet", "DTC skincare", "1:1 coaching", "unknown"
- audience_type: who they serve, 1 line
- has_visible_offer: true ONLY if bio or captions clearly advertise a paid offer / product / service
- offer_confidence: high | medium | low | none`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model: opts.model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "classification", strict: true, schema: SCHEMA },
        },
        temperature: 0.2,
        max_tokens: 400,
      });
      const text = res.choices[0]?.message?.content ?? "";
      const classification = Parsed.parse(JSON.parse(text));
      return {
        classification,
        usage: {
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OpenAI classification failed after retries");
}
