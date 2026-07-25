import "server-only";
import { z } from "zod";
import { createClaude } from "./client";
import { stripLoneSurrogates } from "@/lib/scoring/sanitize";

// Cheap/fast model — this is a one-line triage call, not the ICP scoring pass.
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = `You are triaging replies to cold outreach emails sent to Instagram creators/agencies about a sales offer.

Classify the reply's sentiment toward the offer:
- "positive": interested, wants more info, asks a qualifying question, agrees to a call, says yes/sounds good/tell me more
- "negative": not interested, unsubscribe, "stop emailing me", hostile, wrong person
- "neutral": everything else — out-of-office/auto-reply, unrelated question, ambiguous, too short to tell

Output STRICT JSON only — no prose, no markdown, no code fences.`;

const Parsed = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
});

export async function classifyReplySentiment(opts: {
  apiKey: string;
  subject: string | null;
  body: string;
}): Promise<"positive" | "neutral" | "negative"> {
  const claude = createClaude(opts.apiKey);
  const userPrompt = `Subject: ${opts.subject ?? "(none)"}

Reply body:
${opts.body.slice(0, 2000)}

Return ONLY a JSON object: {"sentiment": "positive"|"neutral"|"negative"}`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await claude.messages.create({
        model: MODEL,
        max_tokens: 50,
        system: SYSTEM,
        messages: [{ role: "user", content: stripLoneSurrogates(userPrompt) }],
      });
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
      const s = stripped.indexOf("{");
      const e = stripped.lastIndexOf("}");
      const slice = s !== -1 && e > s ? stripped.slice(s, e + 1) : stripped;
      return Parsed.parse(JSON.parse(slice)).sentiment;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Reply sentiment classification failed after retries");
}
