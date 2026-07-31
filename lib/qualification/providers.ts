/*
 * Provider-neutral JSON completion.
 *
 * The qualification pipeline only ever needs "system prompt + user prompt ->
 * one JSON object". Keeping that behind a single function means swapping or
 * A/B-ing providers never touches the extraction, challenger, or rule code, and
 * the model identity gets recorded on every stored decision.
 */

export type LlmProvider = "openai" | "anthropic";

export type LlmRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
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
  if (config.provider === "openai") return createOpenAiClient(config);
  return createAnthropicClient(config);
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
        response_format: { type: "json_object" },
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

function createAnthropicClient(config: LlmConfig): LlmClient {
  return async (request) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens ?? 8000,
        temperature: request.temperature ?? 0.1,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (json.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    return {
      text,
      provider: "anthropic",
      model: config.model,
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
    };
  };
}

/*
 * Models still wrap JSON in fences or add a sentence of preamble often enough
 * that failing the whole extraction over it would waste a real API call.
 * Structural repair only — this never changes a value the model returned.
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
