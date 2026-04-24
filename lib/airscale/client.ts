import "server-only";

const AIRSCALE_BASE = "https://api.airscale.io/v1";

export class AirscaleError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = "AirscaleError";
  }
}

export async function airscalePost<T>(opts: {
  apiKey: string;
  path: string;
  body: unknown;
  timeoutMs?: number;
}): Promise<T> {
  const { apiKey, path, body, timeoutMs = 30_000 } = opts;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${AIRSCALE_BASE}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // leave parsed as null; raw text included in the error below
    }
    if (!res.ok) {
      throw new AirscaleError(
        `AirScale ${path} failed (${res.status}): ${text.slice(0, 300)}`,
        res.status,
        parsed ?? text,
      );
    }
    return parsed as T;
  } finally {
    clearTimeout(t);
  }
}
