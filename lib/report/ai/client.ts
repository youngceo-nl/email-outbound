import "server-only";
import OpenAI from "openai";
import { getSettings } from "@/lib/config/settings";

/*
 * The model call for report generation.
 *
 * OpenAI with structured outputs, following the pattern lib/openai/classify.ts
 * already uses — a strict JSON schema enforced by the API beats asking for JSON in
 * a prompt and parsing whatever comes back, which is what the first version of the
 * narrative did.
 *
 * Reports use their own model (app_settings.report_model), separate from the
 * scoring model. Scoring runs thousands of times a day on a cheap model by design;
 * a report runs a few times a day and does open-ended analysis, which is precisely
 * where a small model produces confident generalities instead of findings.
 */

export type AiUnavailable = { reason: "no_api_key" };

export class ReportModelError extends Error {}

/** True when the API rejected the model id itself, rather than the request. */
function isUnknownModel(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /model.*(not found|does not exist|invalid)|unknown model|model_not_found/i.test(err.message);
}

export type StructuredCall = {
  /** Schema name, surfaced in API errors — keep it descriptive. */
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  maxTokens: number;
  /** Analysis wants a little room to reason; writing wants consistency. */
  temperature?: number;
};

export type StructuredResult<T> = { ok: true; data: T; model: string } | { ok: false; reason: string };

/**
 * One structured-output call, with a fallback if the configured model id is wrong.
 *
 * A bad `report_model` value should degrade the prose, not break report
 * generation — so an unknown-model error retries once on the scoring model and
 * says which model actually answered.
 */
export async function callStructured<T>(call: StructuredCall): Promise<StructuredResult<T>> {
  const settings = await getSettings();
  const apiKey = settings.openai_api_key || process.env.OPENAI_API_KEY || "";
  if (!apiKey) return { ok: false, reason: "no OpenAI API key configured in Settings" };

  const client = new OpenAI({ apiKey });
  const primary = settings.report_model || settings.openai_model;
  const fallback = settings.openai_model;

  for (const model of primary === fallback ? [primary] : [primary, fallback]) {
    try {
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
      return { ok: true, data: JSON.parse(text) as T, model };
    } catch (err) {
      if (isUnknownModel(err) && model !== fallback) {
        // Try the scoring model rather than failing outright.
        continue;
      }
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  return { ok: false, reason: "every configured model was rejected" };
}
