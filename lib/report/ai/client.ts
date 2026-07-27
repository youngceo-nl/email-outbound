import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getSettings } from "@/lib/config/settings";
import type { AppSettings } from "@/lib/types";

/*
 * The model call for report generation.
 *
 * Two providers, one interface. Both paths return a strictly-shaped object rather
 * than JSON-in-prose that we then hope to parse — OpenAI via a `json_schema`
 * response format, Claude via a single tool the model is forced to call, whose
 * input_schema is that same schema. The alternative, asking for JSON in the prompt
 * and slicing braces out of the reply, is what lib/claude/classify.ts still does and
 * what the first version of the narrative did; it fails in ways that are annoying to
 * debug and impossible to prevent.
 *
 * The provider is inferred from the model id, so a report runs on Claude or OpenAI
 * purely by what `app_settings.report_model` says — no second setting to keep in
 * sync, and switching is one value in Settings.
 *
 * Reports use their own model, separate from the scoring model. Scoring runs
 * thousands of times a day on a cheap model by design; a report runs a few times a
 * day and does open-ended analysis, which is precisely where a small model produces
 * confident generalities instead of findings.
 */

export type AiUnavailable = { reason: "no_api_key" };

export class ReportModelError extends Error {}

type Provider = "anthropic" | "openai";

/**
 * Which API a model id belongs to.
 *
 * Prefix matching rather than a lookup table, so a model released after this code
 * was written still routes correctly.
 */
function providerFor(model: string): Provider {
  return /^claude/i.test(model) ? "anthropic" : "openai";
}

function keyFor(provider: Provider, settings: AppSettings): string {
  return provider === "anthropic"
    ? settings.claude_api_key || process.env.ANTHROPIC_API_KEY || ""
    : settings.openai_api_key || process.env.OPENAI_API_KEY || "";
}

/**
 * True when the model rejected the configuration rather than doing the work.
 *
 * Covers both an id the API has never heard of and a request shape a given model
 * will not accept — a 400 for an unsupported parameter combination is the same class
 * of problem as a typo'd model name, and both should move to the next candidate
 * rather than fail the report. Errors from the work itself (a rate limit, an
 * overload, a network fault) are not retried on a different model, because a
 * different model would not help.
 */
function isModelRejection(err: unknown): boolean {
  if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.BadRequestError) return true;
  if (err instanceof OpenAI.NotFoundError || err instanceof OpenAI.BadRequestError) return true;
  if (!(err instanceof Error)) return false;
  return /model.*(not found|does not exist|invalid)|unknown model|model_not_found|not_found_error/i.test(err.message);
}

export type StructuredCall = {
  /** Schema name. Surfaced in OpenAI errors and used as the Claude tool name, so keep it descriptive. */
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  /**
   * Room for the answer itself. The Claude path scales this up internally because
   * thinking tokens are drawn from the same budget — see callClaude.
   */
  maxTokens: number;
  /**
   * OpenAI only. Claude Sonnet 5 rejects any non-default sampling parameter with a
   * 400, and controls reasoning depth through effort instead, so this is not
   * portable and is deliberately not emulated on that path.
   */
  temperature?: number;
};

export type StructuredResult<T> = { ok: true; data: T; model: string } | { ok: false; reason: string };

/**
 * One structured-output call, degrading rather than failing when configuration is wrong.
 *
 * Candidates are tried in order: the configured report model, that provider's own
 * default, then the other provider's. A wrong model id or a missing key should cost
 * some prose quality, not the whole report — and the returned `model` says which one
 * actually answered, so a silent downgrade is still visible.
 */
export async function callStructured<T>(call: StructuredCall): Promise<StructuredResult<T>> {
  const settings = await getSettings();

  const wanted = settings.report_model || settings.claude_model || settings.openai_model;
  const ordered = [wanted, providerFor(wanted) === "anthropic" ? settings.claude_model : settings.openai_model]
    .concat(providerFor(wanted) === "anthropic" ? settings.openai_model : settings.claude_model)
    .filter((m): m is string => Boolean(m));

  const candidates: Array<{ model: string; provider: Provider }> = [];
  for (const model of ordered) {
    const provider = providerFor(model);
    if (candidates.some((c) => c.model === model)) continue;
    if (!keyFor(provider, settings)) continue;
    candidates.push({ model, provider });
  }

  if (candidates.length === 0) {
    const provider = providerFor(wanted) === "anthropic" ? "Claude" : "OpenAI";
    return { ok: false, reason: `no ${provider} API key configured in Settings (report model is ${wanted})` };
  }

  const rejected: string[] = [];
  for (const candidate of candidates) {
    const apiKey = keyFor(candidate.provider, settings);
    try {
      const attempt =
        candidate.provider === "anthropic"
          ? await callClaude<T>(call, candidate.model, apiKey)
          : await callOpenAi<T>(call, candidate.model, apiKey);
      // A model that answered but produced nothing usable is a real attempt, not a
      // misconfiguration — say so rather than quietly paying for a second one.
      if (!attempt.ok) return attempt;
      return { ok: true, data: attempt.value, model: candidate.model };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isModelRejection(err)) return { ok: false, reason: `${candidate.model}: ${message}` };
      rejected.push(`${candidate.model}: ${message}`);
    }
  }

  return { ok: false, reason: `every configured model was rejected — ${rejected.join(" | ")}` };
}

type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Claude, via a single tool the model has no choice but to call.
 *
 * Claude has no `json_schema` response format, so the schema is carried as the tool's
 * input_schema and `tool_choice` names that tool. The model cannot answer in prose,
 * and `tool_use.input` arrives already parsed.
 *
 * max_tokens is scaled up because thinking is on by default on Sonnet 5 and is drawn
 * from the same budget as the answer — a limit sized for the JSON alone truncates the
 * reasoning and returns nothing usable.
 */
async function callClaude<T>(call: StructuredCall, model: string, apiKey: string): Promise<Attempt<T>> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: Math.max(call.maxTokens * 4, 16000),
    system: call.system,
    messages: [{ role: "user", content: call.user }],
    tools: [
      {
        name: call.name,
        description: "Return the requested analysis. Every field is required.",
        input_schema: call.schema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: call.name },
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    // Almost always max_tokens: thinking consumed the budget before the tool call.
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").slice(0, 200);
    return {
      ok: false,
      reason: `${model} did not call ${call.name} (stop_reason: ${response.stop_reason}${text ? `, said: ${text}` : ""})`,
    };
  }

  return { ok: true, value: block.input as T };
}

/** OpenAI, via a strict json_schema response format. */
async function callOpenAi<T>(call: StructuredCall, model: string, apiKey: string): Promise<Attempt<T>> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: call.system },
      { role: "user", content: call.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: call.name, strict: true, schema: call.schema },
    },
    temperature: call.temperature ?? 0.3,
    max_tokens: call.maxTokens,
  });

  const text = response.choices[0]?.message?.content ?? "";
  if (!text.trim()) return { ok: false, reason: `${model} returned an empty response` };
  return { ok: true, value: JSON.parse(text) as T };
}
