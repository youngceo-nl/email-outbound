import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getSettings } from "@/lib/config/settings";
import { logLlmUsage } from "@/lib/usage/log-usage";
import type { NicheResearch } from "./build";

/*
 * Live niche price research: what mid-ticket programs actually sell for in this
 * prospect's specific category, found by searching the web at generation time.
 *
 * This is the piece that separates a researched document from a filled-in
 * template. A generic "fitness" band is not researchable; "Spanish-language
 * calisthenics transformation coaching" is — so the model first narrows the
 * niche from the prospect's own bio and offer, then finds real competitors with
 * URLs, and the band comes from what they charge. The competitors render in the
 * report body as the evidence behind the band.
 *
 * Runs on Claude with the server-side web_search tool. The searches happen on
 * Anthropic's side inside one API call; no new scraping infrastructure. Failure
 * is always non-fatal — the caller falls back to the defaults-table band, which
 * is labelled as assumed, exactly as before this existed.
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
  | { ok: true; research: NicheResearch; searches: number; elapsedMs: number }
  | { ok: false; reason: string };

/**
 * One research call. 30–90 seconds when it works; the report waits for it,
 * which is the point — the v3 spec's tell for a templated report was that it
 * generated in 15 seconds because it researched nothing.
 */
export async function researchNichePricing(args: {
  niche: string | null;
  businessModel: string | null;
  bio: string | null;
  offerSummary: string | null;
  leadId?: string | null;
}): Promise<ResearchOutcome> {
  const started = Date.now();
  const settings = await getSettings();
  const apiKey = settings.claude_api_key || process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) return { ok: false, reason: "no Claude API key configured" };

  const model = /^claude/i.test(settings.report_model) ? settings.report_model : settings.claude_model;
  const client = new Anthropic({ apiKey });

  const prospect = [
    args.niche && `Niche as classified: ${args.niche}`,
    args.businessModel && `Business model: ${args.businessModel}`,
    args.offerSummary && `Their current offer: ${args.offerSummary}`,
    args.bio && `Their bio: ${args.bio.slice(0, 400)}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (!prospect) return { ok: false, reason: "nothing known about the niche to research" };

  /*
   * The web_search tool type postdates SDK 0.32.1's typings, but the API accepts
   * it regardless — the SDK just serialises the object. Cast, don't upgrade the
   * SDK in the same change as a feature.
   */
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 6 },
  ] as unknown as Anthropic.Tool[];

  let messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Research mid-ticket pricing for this prospect's niche.\n\n${prospect}` },
  ];

  let searches = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let response: Anthropic.Message | null = null;

  // Server-side search runs inside the call, but a long run can pause the turn;
  // continue up to 3 times, then take whatever text exists.
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await client.messages.create({
      model,
      max_tokens: 4000,
      system: RESEARCH_SYSTEM,
      messages,
      tools,
    });
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    searches += response.content.filter((b) => (b as { type: string }).type === "server_tool_use").length;

    if ((response.stop_reason as string) !== "pause_turn") break;
    messages = [...messages, { role: "assistant", content: response.content }];
  }

  await logLlmUsage({
    provider: "claude",
    model,
    operation: "niche_price_research",
    inputTokens,
    outputTokens,
    leadId: args.leadId ?? null,
  }).catch(() => undefined);

  const text = (response?.content ?? [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  const start = text.lastIndexOf("{");
  const jsonStart = text.lastIndexOf("{", text.lastIndexOf('"niche_label"'));
  const slice = jsonStart !== -1 ? text.slice(jsonStart) : start !== -1 ? text.slice(start) : text;

  let parsed: z.infer<typeof ResearchSchema>;
  try {
    parsed = ResearchSchema.parse(JSON.parse(slice.slice(0, slice.lastIndexOf("}") + 1)));
  } catch {
    return { ok: false, reason: `research reply had no valid JSON (stop: ${response?.stop_reason})` };
  }

  // A band with high below mid is a model slip, not a finding.
  const mid = Math.min(parsed.band_mid, parsed.band_high);
  const high = Math.max(parsed.band_mid, parsed.band_high);

  return {
    ok: true,
    research: {
      band: { mid, high },
      competitors: parsed.competitors.slice(0, 5),
      nicheLabel: parsed.niche_label,
    },
    searches,
    elapsedMs: Date.now() - started,
  };
}
