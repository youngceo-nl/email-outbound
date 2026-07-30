import "server-only";

const HIKER_BASE = "https://api.hikerapi.com";

export class HikerApiError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = "HikerApiError";
  }
}

// Empirically validated (2026-07-30 testing): reusing one long-lived connection
// (e.g. a single Node fetch keep-alive session hammered in a tight loop) triggers
// 403s that a fresh connection per call does not. Concurrency above ~6 simultaneous
// requests starts returning genuine 429s. Keep concurrency conservative by default.
export async function hikerGet<T = unknown>(opts: {
  apiKey: string;
  path: string; // e.g. "/v1/user/by/username"
  params?: Record<string, string | number | undefined>;
  retries?: number;
}): Promise<T> {
  const url = new URL(opts.path, HIKER_BASE);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const retries = opts.retries ?? 3;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { accept: "application/json", "x-access-key": opts.apiKey },
        // no keep-alive reuse across retries — see note above
        cache: "no-store",
      });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
      throw err;
    }

    if (res.status === 429 && attempt < retries) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (res.status === 402) {
      throw new HikerApiError(
        "HikerAPI balance exhausted (402 Payment Required) — top up the account balance on the HikerAPI dashboard.",
        402,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (attempt < retries && (res.status === 403 || res.status >= 500)) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new HikerApiError(`HikerAPI ${res.status} on ${opts.path}: ${body.slice(0, 300)}`, res.status, body);
    }
    return (await res.json()) as T;
  }
  throw lastErr instanceof Error ? lastErr : new HikerApiError(`HikerAPI call failed: ${opts.path}`);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

// /sys/balance is free to call (confirmed: returns 200 even at $0 balance,
// unlike the data endpoints which 402 once funds run out) — safe to poll
// from a UI button without worrying about spending credits just to check them.
export async function getHikerApiBalance(apiKey: string): Promise<{
  amount: number;
  currency: string;
  requests: number;
}> {
  const data = await hikerGet<{ amount?: number; currency?: string; requests?: number }>({
    apiKey,
    path: "/sys/balance",
    retries: 1,
  });
  return {
    amount: data.amount ?? 0,
    currency: data.currency ?? "USD",
    requests: data.requests ?? 0,
  };
}
