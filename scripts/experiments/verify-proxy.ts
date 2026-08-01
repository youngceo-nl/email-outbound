/*
 * Proxy verification: does a given proxy URL actually carry our traffic, and
 * does it hand us the SAME exit IP every time?
 *
 * EXPERIMENT ONLY. Read-only — it visits an IP-echo endpoint and nothing else.
 * Instagram is never contacted.
 *
 * The stability check is the point. A rotating residential session that changes
 * IP between runs is worse than no proxy at all for an authenticated account:
 * Instagram sees one logged-in session hopping subnets, which is the single
 * clearest automation signal available to them.
 *
 * Usage:
 *   tsx --env-file-if-exists=.env.local scripts/experiments/verify-proxy.ts \
 *     --proxy-url "http://user:pass@pr.oxylabs.io:7777" --runs 3
 *
 *   ...add --steel to verify the same proxy through a Steel cloud session,
 *   which is what production will actually use.
 *
 * Credentials are never printed; only a masked form of the username appears.
 */

import { chromium, type Page } from "playwright";
import { openBrowserSession } from "./browser-backend";
import { BROWSER_IDENTITY } from "./playwright-instagram-shared";

/* Oxylabs' own echo endpoint reports ASN and city, which the generic ones do
 * not — that extra detail is how you tell an ISP proxy from a datacenter one. */
const ECHO_ENDPOINTS = ["https://ip.oxylabs.io/location", "https://api.ipify.org?format=json"];

type ExitInfo = {
  ip: string | null;
  country: string | null;
  city: string | null;
  asn: string | null;
  raw: string;
};

type RunResult = {
  run: number;
  ok: boolean;
  exit: ExitInfo | null;
  proxySource: string | null;
  ms: number;
  error: string | null;
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Splits "http://user:pass@host:port" into the shape Playwright wants, which
 * keeps credentials out of the `server` field. Returns a masked label for logs.
 */
export function parseProxyUrl(raw: string): {
  server: string;
  username?: string;
  password?: string;
  label: string;
} {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withScheme);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const server = `${url.protocol}//${url.host}`;

  return {
    server,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    label: `${server} (user ${maskUser(username)})`,
  };
}

/**
 * Oxylabs usernames encode the session id, so the tail is worth showing — it
 * is how you confirm you pinned the session you meant to. The account name in
 * front of it is not.
 */
export function maskUser(username: string): string {
  if (!username) return "none";
  const sessionMatch = /-sessid(?:_oneip)?-([a-z0-9]+)/i.exec(username);
  const session = sessionMatch ? `sessid ${sessionMatch[1]}` : "no sessid";
  return `${username.slice(0, 9)}…, ${session}`;
}

export function parseExitInfo(body: string): ExitInfo {
  const base: ExitInfo = { ip: null, country: null, city: null, asn: null, raw: body.slice(0, 400) };
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const providers = (json.providers ?? {}) as Record<string, unknown>;
    const oxylabs = (providers.oxylabs ?? {}) as Record<string, unknown>;
    return {
      ...base,
      ip: str(json.ip),
      country: str(oxylabs.country ?? json.country ?? json.country_code),
      city: str(oxylabs.city ?? json.city),
      asn: str(oxylabs.asn ?? json.asn ?? json.org),
    };
  } catch {
    // Plain-text echo endpoints just return the address.
    const match = /\b\d{1,3}(?:\.\d{1,3}){3}\b/.exec(body);
    return { ...base, ip: match ? match[0] : null };
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readExitInfo(page: Page): Promise<ExitInfo> {
  let lastError: unknown = null;
  for (const endpoint of ECHO_ENDPOINTS) {
    try {
      await page.goto(endpoint, { timeout: 30_000, waitUntil: "domcontentloaded" });
      const body = await page.innerText("body");
      const info = parseExitInfo(body);
      if (info.ip) return info;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("no echo endpoint returned an IP address");
}

async function runLocal(proxyUrl: string | null): Promise<{ exit: ExitInfo; proxySource: string | null }> {
  const proxy = proxyUrl ? parseProxyUrl(proxyUrl) : null;
  const browser = await chromium.launch({
    headless: true,
    ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
  });
  try {
    const context = await browser.newContext({
      userAgent: BROWSER_IDENTITY.userAgent,
      viewport: BROWSER_IDENTITY.viewport,
      locale: BROWSER_IDENTITY.locale,
      timezoneId: BROWSER_IDENTITY.timezoneId,
    });
    const page = await context.newPage();
    const exit = await readExitInfo(page);
    return { exit, proxySource: proxyUrl ? "external" : null };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runSteel(proxyUrl: string | null): Promise<{ exit: ExitInfo; proxySource: string | null }> {
  const session = await openBrowserSession({
    kind: "steel",
    headed: false,
    proxyUrl,
    sessionTimeoutMs: 120_000,
  });
  try {
    const page = session.context.pages()[0] ?? (await session.context.newPage());
    const exit = await readExitInfo(page);
    return { exit, proxySource: session.proxySource ?? null };
  } finally {
    await session.close();
  }
}

async function main() {
  const proxyUrl = arg("proxy-url") ?? process.env.OXYLABS_PROXY_URL ?? null;
  const runs = Number.parseInt(arg("runs") ?? "3", 10);
  const gapSeconds = Number.parseInt(arg("gap") ?? "0", 10);
  const useSteel = flag("steel");

  if (!proxyUrl) {
    console.log("No --proxy-url given. Measuring your DIRECT exit IP as a baseline.");
    console.log("Anything the proxy reports later must differ from this, or the proxy is not carrying traffic.\n");
  } else {
    console.log(`Proxy: ${parseProxyUrl(proxyUrl).label}`);
  }
  console.log(`Backend: ${useSteel ? "steel" : "local"} | runs: ${runs}${gapSeconds ? ` | gap: ${gapSeconds}s` : ""}\n`);

  const results: RunResult[] = [];

  for (let i = 1; i <= runs; i++) {
    const started = Date.now();
    try {
      const { exit, proxySource } = useSteel ? await runSteel(proxyUrl) : await runLocal(proxyUrl);
      const ms = Date.now() - started;
      results.push({ run: i, ok: true, exit, proxySource, ms, error: null });
      const where = [exit.city, exit.country].filter(Boolean).join(", ") || "location unknown";
      console.log(
        `run ${i}: ${exit.ip} | ${where} | ${exit.asn ?? "asn unknown"} | proxySource ${proxySource ?? "none (direct)"} | ${ms}ms`,
      );
    } catch (err) {
      const ms = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      results.push({ run: i, ok: false, exit: null, proxySource: null, ms, error: message });
      console.log(`run ${i}: FAILED after ${ms}ms — ${message}`);
    }

    if (gapSeconds > 0 && i < runs) {
      await new Promise((resolve) => setTimeout(resolve, gapSeconds * 1000));
    }
  }

  const ips = results.filter((r) => r.ok && r.exit?.ip).map((r) => r.exit!.ip!);
  const unique = [...new Set(ips)];

  console.log("\n--- verdict ---");
  console.log(`successful runs: ${ips.length}/${runs}`);
  console.log(`distinct exit IPs: ${unique.length}`);

  if (ips.length === 0) {
    console.log("RESULT: no run succeeded. The proxy is not usable as configured.");
    process.exitCode = 1;
    return;
  }

  if (proxyUrl) {
    const sources = new Set(results.filter((r) => r.ok).map((r) => r.proxySource ?? "none"));
    if (useSteel && !sources.has("external")) {
      console.log(
        `RESULT: FAIL — Steel reported proxySource ${[...sources].join(", ")}, not "external". The proxyUrl was ignored.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  if (unique.length === 1) {
    console.log(`RESULT: PASS — exit IP stable at ${unique[0]} across ${ips.length} runs.`);
    console.log("Safe to pin one Instagram account to this proxy.");
  } else {
    console.log(`RESULT: FAIL — exit IP rotated: ${unique.join(", ")}`);
    console.log("Do NOT run an authenticated Instagram session through this. Use a sticky sessid, or an ISP proxy port.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
