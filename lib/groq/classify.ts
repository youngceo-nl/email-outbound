import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import type { AiClassification } from "@/lib/scoring/types";
import type { ScrapedProfile } from "@/lib/types";

const SYSTEM = `You are classifying Instagram accounts for a sales outreach team targeting INFOPRENEURS ONLY.

An infopreneur sells KNOWLEDGE or EXPERTISE as a digital product (course, coaching program, mastermind, consulting) to a B2C audience. They close sales via DMs, calls, or webinars — not a checkout button.

DEFAULT RULE: Assume "weak" unless there is explicit evidence of an info/knowledge business. High engagement, a big following, or a link in bio are NOT enough on their own.

icp_signal:
- "strong": account clearly sells a digital knowledge product — bio/captions mention coaching program, course, mastermind, DM to apply, book a call, webinar, or show client results/revenue proof
- "moderate": account is in the right INDUSTRY (education, coaching, consulting) but the offer or price point is unclear — e.g., educates in their niche but no paid product is obvious
- "weak": EVERYTHING ELSE — this includes:
  • Any physical product brand (food, candy, clothing, beauty, supplements, DTC, merch) — even if the founder is an "influencer"
  • Service businesses (restaurant, salon, agency, contractor, transport)
  • B2B SaaS or software
  • Pure content creators, entertainers, meme pages, news accounts
  • Influencers whose only monetisation is affiliate links or brand deals
  • Brands that sell via an online store / checkout button

When in doubt, use "weak". Engagement and follower count do not affect icp_signal.

Output STRICT JSON only — no prose, no markdown, no code fences. Match this shape exactly:
{
  "niche": string,
  "business_model": "course"|"coaching"|"agency"|"ecom"|"saas"|"creator"|"unknown",
  "offer_type": string,
  "audience_type": string,
  "has_visible_offer": boolean,
  "offer_confidence": "high"|"medium"|"low"|"none",
  "icp_signal": "strong"|"moderate"|"weak"
}`;

const Parsed = z.object({
  niche: z.string(),
  business_model: z.enum(["course", "coaching", "agency", "ecom", "saas", "creator", "unknown"]),
  offer_type: z.string(),
  audience_type: z.string(),
  has_visible_offer: z.boolean(),
  offer_confidence: z.enum(["high", "medium", "low", "none"]),
  icp_signal: z.enum(["strong", "moderate", "weak"]),
});

// Groq's free tier is generous (dozens of requests/minute) but still finite —
// pace calls the same way as Gemini so a burst from Inngest's concurrency
// doesn't trip it.
const MAX_CALLS_PER_WINDOW = 25;
const WINDOW_MS = 60_000;
const callTimestamps: number[] = [];

async function waitForRateLimitSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (callTimestamps.length && now - callTimestamps[0] > WINDOW_MS) callTimestamps.shift();
    if (callTimestamps.length < MAX_CALLS_PER_WINDOW) {
      callTimestamps.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, callTimestamps[0] + WINDOW_MS - now + 50));
  }
}

export async function classifyWithGroq(opts: {
  apiKey: string;
  model: string;
  profile: ScrapedProfile;
}): Promise<{ classification: AiClassification; usage: { inputTokens: number; outputTokens: number } }> {
  const groq = new OpenAI({ apiKey: opts.apiKey, baseURL: "https://api.groq.com/openai/v1" });
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
${captions || "(none)"}`;

  let lastErr: unknown = null;
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await waitForRateLimitSlot();
    try {
      const res = await groq.chat.completions.create({
        model: opts.model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 400,
      });
      const text = res.choices[0]?.message?.content ?? "";
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      const classification = Parsed.parse(JSON.parse(stripped));
      return {
        classification,
        usage: {
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number } | null)?.status;
      const delay = status === 429 ? Math.min(60_000, 5000 * 2 ** attempt) : 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Groq classification failed after retries");
}
