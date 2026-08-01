/*
 * Pins each active Instagram account to its own Oxylabs dedicated ISP port and
 * stores the result in shared settings, so every operator of the tool picks up
 * the same pairing.
 *
 * The pairing is the point. One account must always egress from one IP, for its
 * whole life — a session that changes network identity is a stronger automation
 * signal than no proxy at all. This script therefore refuses to assign the same
 * port to two accounts, and refuses to run at all if there are fewer ports than
 * accounts rather than quietly doubling up.
 *
 * Usage (credentials are read from the environment, never committed):
 *
 *   OXYLABS_USER='...' OXYLABS_PASS='...' \
 *     npx tsx --tsconfig tsconfig.scripts.json --env-file-if-exists=.env.local \
 *     scripts/assign-oxylabs-proxies.ts
 *
 * Add --apply to write. Without it the script only prints the plan.
 */
import { createClient } from "@supabase/supabase-js";

const HOST = process.env.OXYLABS_HOST ?? "disp.oxylabs.io";
const PORTS = (process.env.OXYLABS_PORTS ?? "8001,8002,8003,8004,8005")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

const user = process.env.OXYLABS_USER?.trim();
const pass = process.env.OXYLABS_PASS?.trim();
const apply = process.argv.includes("--apply");

if (!user || !pass) {
  console.error("Set OXYLABS_USER and OXYLABS_PASS. Nothing was changed.");
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data: s, error } = await sb.from("app_settings").select("*").eq("id", 1).single();
if (error || !s) throw new Error(error?.message ?? "settings row missing");
const settings = s as Record<string, unknown>;

type Account = Record<string, unknown>;
const accounts = [...((settings.instagram_accounts ?? []) as Account[])];
const activeGroup = settings.active_account_group;

// Only the active group scrapes, so only it needs ports. Ordering is stable
// (array order) so re-running maps the same account to the same port.
const targets = accounts.filter((a) => a.group === activeGroup);

console.log(`active group: ${activeGroup}`);
console.log(`accounts to pin: ${targets.length}`);
console.log(`ports available: ${PORTS.length} (${HOST})\n`);

if (PORTS.length < targets.length) {
  console.error(
    `REFUSING: ${targets.length} accounts but only ${PORTS.length} ports. Two accounts sharing an\n` +
      `exit IP links them permanently. Buy ${targets.length - PORTS.length} more port(s), or pause the extras.`,
  );
  process.exit(1);
}

const credentials = `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`;
const assignments: Array<{ label: string; port: string }> = [];

targets.forEach((account, i) => {
  const port = PORTS[i];
  account.proxy_url = `http://${credentials}@${HOST}:${port}`;
  assignments.push({ label: String(account.label), port });
});

for (const a of assignments) console.log(`  ${a.label.padEnd(20)} -> ${HOST}:${a.port}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write these to shared settings.");
  process.exit(0);
}

const { error: writeErr } = await sb
  .from("app_settings")
  .update({
    instagram_accounts: accounts,
    // The pool is a positional fallback in buildCookiePool. Keeping it in sync
    // stops an account without an explicit proxy from silently borrowing
    // another account's IP by index.
    instagram_proxy_pool: assignments.map((a) => `http://${credentials}@${HOST}:${a.port}`),
  })
  .eq("id", 1);

if (writeErr) throw new Error(writeErr.message);
console.log(`\nWritten. ${assignments.length} accounts pinned.`);
console.log("Next: re-mint each cookie so the session is created from its own IP —");
console.log("Settings > the account > refresh login. The login path now uses the proxy.");
