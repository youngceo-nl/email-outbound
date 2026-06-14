import "server-only";
import { ProxyAgent, fetch as undiciFetch } from "undici";

export class ProxyFetchError extends Error {
  constructor(message: string, public status?: number, public body?: unknown) {
    super(message);
    this.name = "ProxyFetchError";
  }
}

export type ProxyCreds = { user: string; pass: string; provider?: "iproyal" | "9proxy" | "dataimpulse" };

function makeAgent(creds?: ProxyCreds | null): ProxyAgent {
  const provider = creds?.provider ?? "iproyal";

  if (provider === "9proxy") {
    const user = creds?.user || process.env.NINEPROXY_USER;
    const pass = creds?.pass || process.env.NINEPROXY_PASS;
    if (!user || !pass) throw new ProxyFetchError("9proxy credentials not set — configure in Settings or set NINEPROXY_USER / NINEPROXY_PASS env vars");
    return new ProxyAgent(`http://${user}:${pass}@proxy.9proxy.com:6060`);
  }

  if (provider === "dataimpulse") {
    const user = creds?.user || process.env.DATAIMPULSE_USER;
    const pass = creds?.pass || process.env.DATAIMPULSE_PASS;
    if (!user || !pass) throw new ProxyFetchError("DataImpulse credentials not set — configure in Settings or set DATAIMPULSE_USER / DATAIMPULSE_PASS env vars");
    return new ProxyAgent(`http://${user}:${pass}@gw.dataimpulse.com:823`);
  }

  const user = creds?.user || process.env.IPROYAL_USER;
  const pass = creds?.pass || process.env.IPROYAL_PASS;
  if (!user || !pass) throw new ProxyFetchError("IPRoyal credentials not set — configure in Settings or set IPROYAL_USER / IPROYAL_PASS env vars");
  return new ProxyAgent(`http://${user}:${pass}@geo.iproyal.com:12321`);
}

export async function proxyFetch(
  url: string,
  headers: Record<string, string>,
  opts?: { retries?: number; creds?: ProxyCreds | null },
): Promise<{ status: number; body: string }> {
  const retries = opts?.retries ?? 2;
  const agent = makeAgent(opts?.creds);
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await undiciFetch(url, { headers, dispatcher: agent });
      const body = await res.text();
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new ProxyFetchError(`proxy fetch ${res.status}: ${body.slice(0, 200)}`, res.status, body);
      }
      return { status: res.status, body };
    } catch (err) {
      if (err instanceof ProxyFetchError) throw err;
      lastErr = err;
      if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProxyFetchError("proxy fetch failed");
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
