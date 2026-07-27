import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { getSettings } from "@/lib/config/settings";
import { logLlmUsage } from "@/lib/usage/log-usage";
import type { AppSettings } from "@/lib/types";
import type { NicheResearch } from "./build";

/*
 * Live niche price research: what mid-ticket programs actually sell for in this
 * prospect's specific category, found by searching the web at generation time.
 *
 * This is the piece that separates a researched document from a filled-in
 * template. A generic "fitness" band is not researchable; "Spanish-language
 * calisthenics transformation coaching" is — so the model first narrows the
 * niche from the prospect's own bio and offer, then finds real competitors with
 * URLs, and the band comes from what they charge.
 *
 * Provider follows report_model, same as the analysis passes: a GPT id runs the
 * search on OpenAI's Responses API web-search tool, a Claude id on Anthropic's
 * server-side web_search. Whichever provider has no key is skipped, so pointing
 * report_model at a GPT means report generation spends no Claude usage at all.
 *
 * Failure is always non-fatal — the caller falls back to the defaults-table
 * band, labelled as assumed — but never silent: the reason is returned and the
 * run prints it on the report row.
 */

const RESEARCH_SYSTEM = `You research market pricing for Conversion Brands, an agency that builds webinar funnels.

Given a prospect, find what comparable mid-ticket programs (roughly $200–$3,000, sold at direct checkout) cost in their SPECIFIC niche. Narrow the niche first: "fitness" is not researchable, "Spanish-language calisthenics transformation coaching for men" is.

Rules:
- Find at least 3 real, currently-sold programs from DIFFERENT creators or companies in the same niche. Each needs a name, a price you actually saw, and the URL you saw it on.
- Prices must be real figures from real pages found in your searches — never estimated, never "typically around".
- Competitors must be comparable: same audience type, same delivery format (course/program/group coaching), similar scope. A $29/mo app is not comparable to a $997 program.
- If you cannot find 3 genuine comparables, say so — return fewer rather than padding with weak matches.

After searching, end your reply with ONLY a JSON object on its own lines, no prose after it:
{
  "niche_label": "the narrowed niche in under 10 words",
  "competitors": [{ "name": "...", "price": "$997", "url": "https://..." }],
  "band_mid": 997,
  "band_high": 1997
}
band_mid is the typical price among the comparables; band_high is the top of the credible range (still under $3,000). Numbers, not strings.`;

const ResearchSchema = z.object({
  niche_label: z.string().min(3),
  competitors: z
    .array(z.object({ name: z.string().min(2), price: z.string().min(2), url: z.string().url() }))
    .min(1),
  band_mid: z.number().min(100).max(3000),
  band_high: z.number().min(100).max(3000),
});

export type ResearchOutcome =
  | { ok: true; research: NicheResearch; provider: string; elapsedMs: number }
  | { ok: false; reason: string };

/** Extracts and validates the trailing JSON object from a model reply. */
function parseResearch(text: string): z.infer<typeof ResearchSchema> | null {
  const anchor = text.lastIndexOf('"niche_label"');
  const start = anchor !== -1 ? text.lastIndexOf("{", anchor) : text.lastIndexOf("{");
  if (start === -1) return null;
  const slice = text.slice(start, text.lastIndexOf("}") + 1);
  try {
    return ResearchSchema.parse(JSON.parse(slice));
  } catch {
    return null;
  }
}

function prospectBrief(args: ResearchArgs): string {
  return [
    args.niche && `Niche as classified: ${args.niche}`,
    args.businessModel && `Business model: ${args.businessModel}`,
    args.offerSummary && `Their current offer: ${args.offerSummary}`,
    args.bio && `Their bio: ${args.bio.slice(0, 400)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type ResearchArgs = {
  niche: string | null;
  businessModel: string | null;
  bio: string | null;
  offerSummary: string | null;
  leadId?: string | null;
};

/**
 * One research call. 30–90 seconds when it works; the report waits for it,
 * which is the point — a report that generates in 15 seconds researched
 * nothing.
 */
export async function researchNichePricing(args: ResearchArgs): Promise<ResearchOutcome> {
  const started = Date.now();
  const settings = await getSettings();

  const brief = prospectBrief(args);
  if (!brief) return { ok: false, reason: "nothing known about the niche to research" };

  const wantClaude = /^claude/i.test(settings.report_model ?? "");
  const claudeKey = settings.claude_api_key || process.env.ANTHROPIC_API_KEY || "";
  const openaiKey = settings.openai_api_key || process.env.OPENAI_API_KEY || "";

  // Provider follows report_model; a missing key falls through to the other.
  const order: Array<"anthropic" | "openai"> = wantClaude ? ["anthropic", "openai"] : ["openai", "anthropic"];
  const reasons: string[] = [];

  for (const provider of order) {
    if (provider === "anthropic" && !claudeKey) {
      reasons.push("no Claude key");
      continue;
    }
    if (provider === "openai" && !openaiKey) {
      reasons.push("no OpenAI key");
      continue;
    }
    try {
      const result =
        provider === "anthropic"
          ? await claudeResearch(settings, claudeKey, brief, args.leadId ?? null)
          : await openaiResearch(settings, openaiKey, brief, args.leadId ?? null);
      if (result) return { ok: true, research: result.research, provider: result.model, elapsedMs: Date.now() - started };
      reasons.push(`${provider}: reply had no valid JSON`);
    } catch (err) {
      reasons.push(`${provider}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`);
    }
  }

  return { ok: false, reason: reasons.join("; ") };
}

type ProviderResult = { research: NicheResearch; model: string } | null;

function toResearch(parsed: z.infer<typeof ResearchSchema>): NicheResearch {
  // A band with high below mid is a model slip, not a finding.
  const mid = Math.min(parsed.band_mid, parsed.band_high);
  const high = Math.max(parsed.band_mid, parsed.band_high);
  return { band: { mid, high }, competitors: parsed.competitors.slice(0, 5), nicheLabel: parsed.niche_label };
}

/**
 * OpenAI path: the Responses API with its built-in web-search tool. Tries the
 * configured report model first; if that model can't search, retries once on
 * gpt-4o, which can.
 */
async function openaiResearch(
  settings: AppSettings,
  apiKey: string,
  brief: string,
  leadId: string | null,
): Promise<ProviderResult> {
  const client = new OpenAI({ apiKey });
  const configured = settings.report_model && !/^claude/i.test(settings.report_model) ? settings.report_model : null;
  const models = [...new Set([configured, "gpt-4o"].filter((m): m is string => Boolean(m)))];

  let lastErr: unknown = null;
  for (const model of models) {
    try {
      const response = await client.responses.create({
        model,
        // The SDK's union for tools lags the API here; the wire accepts it.
        tools: [{ type: "web_search" } as never],
        instructions: RESEARCH_SYSTEM,
        input: `Research mid-ticket pricing for this prospect's niche.\n\n${brief}`,
      });

      await logLlmUsage({
        provider: "openai",
        model,
        operation: "niche_price_research",
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        leadId,
      }).catch(() => undefined);

      const parsed = parseResearch(response.output_text ?? "");
      if (parsed) return { research: toResearch(parsed), model };
      return null;
    } catch (err) {
      lastErr = err;
      // A model that rejects the tool or doesn't exist → try the next; anything
      // else (auth, rate limit) won't improve on a different model.
      const message = err instanceof Error ? err.message : "";
      if (!/model|tool|web_search|not.*(found|supported)|invalid/i.test(message)) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("OpenAI research failed");
}

/** Claude path: server-side web_search inside one messages call. */
async function claudeResearch(
  settings: AppSettings,
  apiKey: string,
  brief: string,
  leadId: string | null,
): Promise<ProviderResult> {
  const model = /^claude/i.test(settings.report_model ?? "") ? settings.report_model : settings.claude_model;
  const client = new Anthropic({ apiKey });

  // The web_search tool type postdates SDK 0.32.1's typings; the API accepts it.
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }] as unknown as Anthropic.Tool[];

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Research mid-ticket pricing for this prospect's niche.\n\n${brief}` },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let response: Anthropic.Message | null = null;

  // Server-side search runs inside the call, but a long run can pause the turn;
  // continue up to 3 times, then take whatever text exists.
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await client.messages.create({ model, max_tokens: 4000, system: RESEARCH_SYSTEM, messages, tools });
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    if ((response.stop_reason as string) !== "pause_turn") break;
    messages = [...messages, { role: "assistant", content: response.content }];
  }

  await logLlmUsage({
    provider: "claude",
    model,
    operation: "niche_price_research",
    inputTokens,
    outputTokens,
    leadId,
  }).catch(() => undefined);

  const text = (response?.content ?? [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  const parsed = parseResearch(text);
  return parsed ? { research: toResearch(parsed), model } : null;
}
