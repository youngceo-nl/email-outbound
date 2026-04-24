import "server-only";

const APIFY_BASE = "https://api.apify.com/v2";

export class ApifyError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = "ApifyError";
  }
}

type RunActorOptions = {
  token: string;
  actorId: string;        // e.g. "apify~instagram-profile-scraper"
  input: unknown;
  timeoutSecs?: number;   // sync run timeout
  memoryMbytes?: number;
  retries?: number;
};

// Runs an actor synchronously and returns the dataset items.
// `run-sync-get-dataset-items` is the cheapest path: one HTTP call, no polling.
export async function runActorSync<T = unknown>(opts: RunActorOptions): Promise<T[]> {
  const {
    token,
    actorId,
    input,
    timeoutSecs = 300,
    memoryMbytes = 1024,
    retries = 2,
  } = opts;

  const url = new URL(`${APIFY_BASE}/acts/${actorId}/run-sync-get-dataset-items`);
  url.searchParams.set("token", token);
  url.searchParams.set("timeout", String(timeoutSecs));
  url.searchParams.set("memory", String(memoryMbytes));
  url.searchParams.set("format", "json");

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // 429 / 5xx → retryable
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new ApifyError(`Apify ${actorId} failed: ${res.status}`, res.status, text);
      }
      return (await res.json()) as T[];
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ApifyError("Apify call failed");
}

function backoffMs(attempt: number) {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
