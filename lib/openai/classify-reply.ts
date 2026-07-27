import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { stripLoneSurrogates } from "@/lib/scoring/sanitize";

// Cheap/fast model — this is a one-line triage call, not the ICP scoring pass.
const MODEL = "gpt-4o-mini";

const SYSTEM = `You are triaging replies to cold outreach emails sent to Instagram creators/agencies about a sales offer.

Classify the reply's sentiment toward the offer:
- "positive": interested, wants more info, asks a qualifying question, agrees to a call, says yes/sounds good/tell me more
- "negative": not interested, unsubscribe, "stop emailing me", hostile, wrong person
- "neutral": everything else — out-of-office/auto-reply, unrelated question, ambiguous, too short to tell

Output STRICT JSON only — no prose, no markdown, no code fences.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sentiment"],
  properties: {
    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
  },
} as const;

const Parsed = z.object({
  sentiment: z.enum(["positive", "neutral", "negative"]),
});

export async function classifyReplySentiment(opts: {
  apiKey: string;
  subject: string | null;
  body: string;
}): Promise<"positive" | "neutral" | "negative"> {
  const openai = new OpenAI({ apiKey: opts.apiKey });
  const userPrompt = `Subject: ${opts.subject ?? "(none)"}

Reply body:
${opts.body.slice(0, 2000)}

Return ONLY a JSON object: {"sentiment": "positive"|"neutral"|"negative"}`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: stripLoneSurrogates(userPrompt) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "reply_sentiment", strict: true, schema: SCHEMA },
        },
        temperature: 0.2,
        max_tokens: 50,
      });
      const text = res.choices[0]?.message?.content ?? "";
      return Parsed.parse(JSON.parse(text)).sentiment;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Reply sentiment classification failed after retries");
}
