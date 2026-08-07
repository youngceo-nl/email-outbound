/*
 * Provider-neutral JSON completion.
 *
 * Anthropic is the primary path and uses the official SDK with native
 * structured output (`output_config.format`), so the response shape is
 * constrained at generation time rather than hoped for in the prompt. OpenAI
 * remains available as a fallback provider for comparison runs.
 *
 * Structured output guarantees SHAPE only. It cannot express "an affirmative
 * claim must cite evidence", so every response is still re-validated with Zod
 * downstream — that rule is what keeps the pipeline honest.
 */

import Anthropic from "@anthropic-ai/sdk";

export type LlmProvider = "anthropic" | "openai" | "openrouter";

export type LlmImageInput = {
  /** Citable id — becomes the vision facts' evidence source_id. */
  sourceId: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  base64Data: string;
};

export type LlmRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Strict JSON Schema for native structured output. */
  jsonSchema?: Record<string, unknown>;
  schemaName?: string;
  /*
   * Images attached to the user turn, for the Gate 2 visual-identity pass
   * (lib/qualification/visual-identity.ts). Empty/omitted for every other
   * call site — text extraction and the challenger stay text-only.
   */
  images?: LlmImageInput[];
};

export type LlmResponse = {
  text: string;
  provider: LlmProvider;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
};

export type LlmClient = (request: LlmRequest) => Promise<LlmResponse>;

export type LlmConfig = {
  provider: LlmProvider;
  model: string;
  apiKey: string;
};

export function createLlmClient(config: LlmConfig): LlmClient {
  if (config.provider === "anthropic") return createAnthropicClient(config);
  if (config.provider === "openrouter") return createOpenRouterClient(config);
  return createOpenAiClient(config);
}

function createAnthropicClient(config: LlmConfig): LlmClient {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 3 });

  return async (request) => {
    const content =
      request.images && request.images.length > 0
        ? [
            ...request.images.map((image) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: image.mediaType, data: image.base64Data },
            })),
            { type: "text" as const, text: request.user },
          ]
        : request.user;

    const params: Record<string, unknown> = {
      model: config.model,
      max_tokens: request.maxTokens ?? 8000,
      system: request.system,
      messages: [{ role: "user", content }],
    };

    /*
     * Sampling parameters were removed on the Opus 4.7+ / Sonnet 5 / Fable 5
     * generation and are rejected outright there. Only send `temperature` to
     * models that still accept it — Haiku 4.5 does, and a low temperature keeps
     * extraction stable across reruns.
     */
    if (request.temperature !== undefined && modelAcceptsTemperature(config.model)) {
      params.temperature = request.temperature;
    }

    if (request.jsonSchema) {
      // `format` takes only `type` and `schema`; a `name` field is rejected.
      params.output_config = {
        format: { type: "json_schema", schema: request.jsonSchema },
      };
    }

    const response = await client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    /*
     * A refusal returns HTTP 200 with an empty or partial body. Surfacing it as
     * an error keeps it out of the "model produced bad JSON" bucket, which would
     * otherwise send a perfectly good lead to review for the wrong reason.
     */
    if (response.stop_reason === "refusal") {
      throw new Error("Anthropic declined the request (stop_reason: refusal)");
    }
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        `Anthropic response hit max_tokens (${params.max_tokens}); the extraction was truncated`,
      );
    }

    return {
      text,
      provider: "anthropic",
      model: config.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  };
}

/*
 * Allowlist rather than blocklist: a model we have not seen before is assumed to
 * reject sampling params, which fails safe. Sending one to a model that rejects
 * it is a hard 400 that kills the call; omitting one from a model that accepts it
 * only means the default is used.
 */
export function modelAcceptsTemperature(model: string): boolean {
  return /claude-(haiku-4-5|sonnet-4-5|sonnet-4-6|opus-4-5|opus-4-6)|^gpt-/.test(model);
}

function createOpenAiClient(config: LlmConfig): LlmClient {
  return async (request) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: request.jsonSchema
          ? {
              type: "json_schema",
              json_schema: {
                name: request.schemaName ?? "extraction",
                strict: false,
                schema: request.jsonSchema,
              },
            }
          : { type: "json_object" },
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 8000,
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      provider: "openai",
      model: config.model,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  };
}

/*
 * OpenRouter — a single OpenAI-compatible endpoint in front of many
 * providers' models (Gemini, DeepSeek, Llama, Qwen, ...), used here to
 * benchmark cheaper/alternate models against the production extractor. Same
 * request/response shape as createOpenAiClient, just a different base URL
 * and the attribution headers OpenRouter asks integrators to send. Structured
 * output support varies by the underlying routed model — some ignore
 * `response_format` — but that is exactly what the caller's repair-on-
 * invalid-JSON retry (see extract.ts) already exists to catch.
 */
function createOpenRouterClient(config: LlmConfig): LlmClient {
  return async (request) => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "HTTP-Referer": "https://app.paidinfunnel.com",
        "X-Title": "email-outbound extraction benchmark",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: request.jsonSchema
          ? {
              type: "json_schema",
              json_schema: {
                name: request.schemaName ?? "extraction",
                strict: false,
                schema: request.jsonSchema,
              },
            }
          : { type: "json_object" },
        temperature: request.temperature ?? 0.1,
        max_tokens: request.maxTokens ?? 8000,
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      provider: "openrouter",
      model: config.model,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  };
}

/*
 * Structured output should make this unnecessary, but a fenced or preamble-
 * wrapped response still happens often enough that failing the whole extraction
 * over it would waste a real API call. Structural repair only — this never
 * changes a value the model returned.
 */
export function parseJsonLoose(raw: string): unknown {
  const text = raw.trim();
  if (!text) throw new Error("empty model response");

  try {
    return JSON.parse(text);
  } catch {
    // fall through to recovery
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }

  throw new Error(`model response was not JSON: ${text.slice(0, 200)}`);
}
