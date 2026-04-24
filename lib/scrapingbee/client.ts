import "server-only";

const SB_BASE = "https://app.scrapingbee.com/api/v1/";

export class ScrapingBeeError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = "ScrapingBeeError";
  }
}

export type SbOptions = {
  apiKey: string;
  url: string;
  renderJs?: boolean;
  premiumProxy?: boolean;
  countryCode?: string;
  forwardHeaders?: Record<string, string>;  // requires premium plan
  retries?: number;
};

export async function scrapingBeeGet(opts: SbOptions): Promise<{ status: number; body: string }> {
  const params = new URLSearchParams({
    api_key: opts.apiKey,
    url: opts.url,
    render_js: opts.renderJs ? "true" : "false",
    premium_proxy: opts.premiumProxy ? "true" : "false",
    block_resources: "true",
  });
  if (opts.countryCode) params.set("country_code", opts.countryCode);
  if (opts.forwardHeaders) params.set("forward_headers", "true");

  const headers: Record<string, string> = {};
  if (opts.forwardHeaders) {
    for (const [k, v] of Object.entries(opts.forwardHeaders)) {
      headers[`Spb-${k}`] = v;
    }
  }

  const retries = opts.retries ?? 2;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${SB_BASE}?${params.toString()}`, { headers });
      const body = await res.text();
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ScrapingBeeError(`ScrapingBee ${res.status}: ${body.slice(0, 200)}`, res.status, body);
      }
      return { status: res.status, body };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ScrapingBeeError("ScrapingBee call failed");
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
