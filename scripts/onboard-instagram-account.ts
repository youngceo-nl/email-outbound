/*
 * Logs an Instagram account in through THIS PC's self-hosted Steel instance
 * instead of a local browser, then stores the resulting session cookie in the
 * shared account pool (app_settings.instagram_accounts).
 *
 * Steel never sees the password: it opens a live, human-drivable browser
 * session and this script prints the viewer URL. You open that URL yourself
 * and log in — handling 2FA/checkpoints personally, exactly like any normal
 * login — while the script only watches for the resulting `sessionid` cookie
 * and captures it once it appears. Nothing about the cookie is logged.
 *
 * Because no password/TOTP is captured, the account this creates is NOT
 * eligible for the existing automated cookie-refresh cron
 * (inngest/functions/refresh-ig-cookies.ts, currently disabled anyway) —
 * that path re-mints cookies from a stored password. Re-run this script by
 * hand when the cookie eventually expires.
 *
 * Requires CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET in the environment
 * when steel_base_url points at the tunneled self-hosted instance (see
 * self-hosting-server ADR-006) — without them Cloudflare Access 403s the
 * session-create call before it reaches Steel.
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env.local scripts/onboard-instagram-account.ts \
 *     --label some_username --proxy 'http://user:pass@host:port' [--group A] [--apply]
 *
 * Without --apply, the cookie is captured and shown (masked) but nothing is
 * written to shared settings — check the plan, then re-run with --apply.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { openBrowserSession } from "./experiments/browser-backend";
import { isAuthenticated } from "./experiments/playwright-instagram-shared";
import type { AppSettings, ManagedAccount } from "../lib/types";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const AUTH_COOKIE_NAMES = new Set(["sessionid", "csrftoken", "ds_user_id", "ig_did", "mid", "ig_nrcb", "rur"]);

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function mask(cookie: string): string {
  return cookie.length <= 24 ? cookie : `${cookie.slice(0, 20)}…${cookie.slice(-4)}`;
}

async function main(): Promise<void> {
  const label = arg("label")?.trim();
  const proxyUrl = arg("proxy")?.trim() || null;
  const group = arg("group")?.trim() || null;
  const apply = process.argv.includes("--apply");

  if (!label) {
    console.error(
      "Usage: npx tsx scripts/onboard-instagram-account.ts --label <username> " +
        "[--proxy <url>] [--group <letter>] [--apply]",
    );
    process.exit(1);
  }
  if (!proxyUrl) {
    console.warn(
      "WARNING: no --proxy given. This login's IP won't match whatever IP future scrapes\n" +
        "use for this account — a strong ban signal. Recommended: pin one (see assign-oxylabs-proxies.ts).",
    );
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await sb.from("app_settings").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(error?.message ?? "settings row missing");
  const settings = data as AppSettings;

  const baseUrl = settings.steel_base_url || process.env.STEEL_BASE_URL || null;
  console.log(`Opening a Steel session on ${baseUrl ?? "Steel Cloud (no self-hosted base url set)"}`);

  const session = await openBrowserSession({
    kind: "steel",
    headed: false,
    proxyUrl,
    steelApiKey: settings.steel_api_key ?? null,
    steelBaseUrl: settings.steel_base_url ?? null,
  });

  let cookieHeader: string | null = null;
  try {
    if (!session.debugUrl) throw new Error("Steel did not return a live-viewer URL for this session");
    console.log(`\nOpen this URL and log in to Instagram as @${label} (handle 2FA/checkpoints yourself):`);
    console.log(`  ${session.debugUrl}\n`);
    console.log("Waiting for a session cookie to appear (up to 5 minutes)...");

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await isAuthenticated(session.context)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const cookies = await session.context.cookies("https://www.instagram.com");
    const hasSession = cookies.some((c) => c.name === "sessionid" && c.value.length > 0);
    if (!hasSession) {
      console.error("No sessionid cookie appeared within the timeout. Nothing was captured or written.");
      process.exitCode = 1;
      return;
    }

    cookieHeader = cookies
      .filter((c) => AUTH_COOKIE_NAMES.has(c.name))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    console.log(`Captured session cookie: ${mask(cookieHeader)}`);
  } finally {
    await session.close();
  }

  if (!cookieHeader) return;

  const accounts = [...(settings.instagram_accounts ?? [])];
  const existingIndex = accounts.findIndex((a) => a.label === label);
  const now = new Date().toISOString();

  if (existingIndex !== -1) {
    accounts[existingIndex] = {
      ...accounts[existingIndex],
      cookie: cookieHeader,
      cookie_set_at: now,
      last_error: null,
      checkpoint_state: null,
      ...(proxyUrl ? { proxy_url: proxyUrl } : {}),
      ...(group ? { group } : {}),
    };
    console.log(`\nWill update existing account @${label}.`);
  } else {
    const fresh: ManagedAccount = {
      id: randomUUID(),
      label,
      password: "",
      totp_secret: null,
      account_email: null,
      cookie: cookieHeader,
      cookie_set_at: now,
      last_error: null,
      checkpoint_state: null,
      proxy_url: proxyUrl,
      steel_profile_id: null,
      group,
      paused: false,
    };
    accounts.push(fresh);
    console.log(`\nWill add new account @${label}.`);
  }

  if (!apply) {
    console.log("Dry run — nothing written. Re-run with --apply to save this to the shared account pool.");
    return;
  }

  const { data: written, error: writeError } = await sb
    .from("app_settings")
    .update({ instagram_accounts: accounts })
    .eq("id", 1)
    .eq("updated_at", settings.updated_at)
    .select("id")
    .maybeSingle();
  if (writeError) throw new Error(writeError.message);
  if (!written) {
    throw new Error("Shared settings changed during this run — re-run to pick up the latest state before retrying.");
  }
  console.log(`Written. @${label} is now in the shared account pool.`);
}

main().catch((err) => {
  console.error("Onboarding failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
