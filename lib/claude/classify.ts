import "server-only";
import { z } from "zod";
import { createClaude } from "./client";
import type { AiClassification } from "@/lib/scoring/types";
import type { ScrapedProfile } from "@/lib/types";

const SYSTEM = `You are classifying an Instagram creator/business account for a B2B outbound team.
Output STRICT JSON only — no prose, no markdown, no code fences. Be decisive.`;

const SCHEMA_HINT = `{
  "niche": string,
  "business_model": "course"|"coaching"|"agency"|"ecom"|"saas"|"creator"|"unknown",
  "offer_type": string,
  "audience_type": string,
  "has_visible_offer": boolean,
  "offer_confidence": "high"|"medium"|"low"|"none"
}`;

const Parsed = z.object({
  niche: z.string(),
  business_model: z.enum(["course", "coaching", "agency", "ecom", "saas", "creator", "unknown"]),
  offer_type: z.string(),
  audience_type: z.string(),
  has_visible_offer: z.boolean(),
  offer_confidence: z.enum(["high", "medium", "low", "none"]),
});

export async function classifyWithClaude(opts: {
  apiKey: string;
  model: string;
  profile: ScrapedProfile;
}): Promise<{ classification: AiClassification; usage: { inputTokens: number; outputTokens: number } }> {
  const claude = createClaude(opts.apiKey);
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

Return ONLY a JSON object matching:
${SCHEMA_HINT}`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await claude.messages.create({
        model: opts.model,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
      });
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      const s = stripped.indexOf("{");
      const e = stripped.lastIndexOf("}");
      const slice = s !== -1 && e > s ? stripped.slice(s, e + 1) : stripped;
      const classification = Parsed.parse(JSON.parse(slice));
      return {
        classification,
        usage: {
          inputTokens: res.usage?.input_tokens ?? 0,
          outputTokens: res.usage?.output_tokens ?? 0,
        },
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Claude classification failed after retries");
}
