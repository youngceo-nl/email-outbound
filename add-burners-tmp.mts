/*
 * Throwaway: add 5 burner Instagram accounts, pair each with an existing
 * Oxylabs proxy, and mint a cookie via the mobile login (no browser).
 *
 *   npx tsx add-burners-tmp.mts            # dry run, shows the plan
 *   npx tsx add-burners-tmp.mts --apply --only 1   # do just the first
 *   npx tsx add-burners-tmp.mts --apply            # do all five
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { createAdminClient } = await import("./lib/supabase/admin");
const { loginInstagramMobile } = await import("./lib/instagram/login-mobile");

const APPLY = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx !== -1 ? Number(process.argv[onlyIdx + 1]) : null;

const IG_PASSWORD = "Saif@1234";
const NEW_EMAILS = [
  "keithwatsonixff@outlook.com",
  "kenjinavavxbx@outlook.com",
  "kylangibbsszhf@outlook.com",
  "matiasnielsenkqc@outlook.com",
  "ozzykerrbmda@outlook.com",
];

type Account = Record<string, unknown> & {
  id?: string;
  label?: string;
  password?: string | null;
  account_email?: string | null;
  cookie?: string | null;
  cookie_set_at?: string | null;
  proxy_url?: string | null;
  group?: string | null;
  paused?: boolean;
  last_error?: string | null;
};

const mask = (u?: string | null) => {
  if (!u) return "-";
  try { const x = new URL(u); return `${x.protocol}//***@${x.host}`; } catch { return "***"; }
};

const sb = createAdminClient();
const { data: settingsRow, error: readErr } = await sb
  .from("app_settings").select("instagram_accounts, updated_at").eq("id", 1).single();
if (readErr || !settingsRow) throw new Error(`read failed: ${readErr?.message}`);

const accounts: Account[] = [...((settingsRow.instagram_accounts ?? []) as Account[])];

// The proxies to share, taken from the existing group-C accounts in order.
const proxies = accounts
  .filter((a) => typeof a.proxy_url === "string" && a.proxy_url.trim())
  .map((a) => a.proxy_url as string);
const uniqueProxies = [...new Set(proxies)];
if (uniqueProxies.length < NEW_EMAILS.length) {
  console.warn(`only ${uniqueProxies.length} proxies for ${NEW_EMAILS.length} accounts — some will pair up`);
}

console.log(`existing accounts: ${accounts.length} | distinct proxies: ${uniqueProxies.length}\n`);

type Plan = { email: string; proxy: string; existing: Account | null; pairedWith: string };
const plans: Plan[] = NEW_EMAILS.map((email, i) => {
  const label = email.toLowerCase();
  const prefix = label.split("@")[0];
  // Reuse an account that is already this identity, matched on the exact label
  // or on the email's local part (keithwatsonixff@ -> keithwatsonixff2026).
  const existing =
    accounts.find((a) => String(a.label ?? "").toLowerCase() === label) ??
    accounts.find((a) => String(a.label ?? "").toLowerCase().startsWith(prefix)) ??
    null;
  const proxy = uniqueProxies[i % uniqueProxies.length];
  const owner = accounts.find((a) => a.proxy_url === proxy && a !== existing);
  return { email: label, proxy, existing, pairedWith: String(owner?.label ?? "(none)") };
});

for (const [i, p] of plans.entries()) {
  console.log(
    `${i + 1}. ${p.email}\n` +
      `     ${p.existing ? `REUSE existing "${p.existing.label}"` : "CREATE new account"}\n` +
      `     proxy ${mask(p.proxy)}  (shares IP with ${p.pairedWith})`,
  );
}

if (!APPLY) {
  console.log(`\nDry run. Re-run with --apply (optionally --only <n>) to execute.`);
  process.exit(0);
}

const targets = ONLY ? [plans[ONLY - 1]] : plans;
console.log(`\nApplying to ${targets.length} account(s)…\n`);

for (const p of targets) {
  const label = p.email;
  let account = p.existing;

  if (!account) {
    account = {
      id: crypto.randomUUID(),
      label,
      password: IG_PASSWORD,
      totp_secret: null,
      account_email: label,
      cookie: null,
      cookie_set_at: null,
      last_error: null,
      checkpoint_state: null,
      proxy_url: p.proxy,
      group: "C",
      paused: false,
    };
    accounts.push(account);
    console.log(`[${label}] created`);
  } else {
    account.password = account.password || IG_PASSWORD;
    account.account_email = account.account_email || label;
    account.proxy_url = p.proxy;
    account.group = "C";
    account.paused = false;
    console.log(`[${label}] reusing "${account.label}" — proxy set, group C`);
  }

  // Mobile login: no browser, goes out through this account's own proxy.
  const loginId = String(account.label ?? label);
  console.log(`[${label}] logging in as "${loginId}" via ${mask(p.proxy)} …`);
  const result = await loginInstagramMobile({
    username: loginId,
    password: String(account.password ?? IG_PASSWORD),
    totp_secret: (account.totp_secret as string | null) ?? null,
    proxy_url: p.proxy,
  });

  if (result.ok) {
    account.cookie = result.cookie;
    account.cookie_set_at = new Date().toISOString();
    account.last_error = null;
    console.log(`[${label}] OK — cookie minted (${result.cookie.length} chars)`);
  } else {
    const msg = "error" in result ? result.error : (result as { message: string }).message;
    account.last_error = msg;
    console.log(`[${label}] FAILED — ${msg}`);
    if ("checkpoint" in result && result.checkpoint) {
      console.log(`[${label}] CHECKPOINT — stopping here, needs manual verification.`);
      break;
    }
  }
}

// Compare-and-swap, same guard quarantine.ts uses: refresh-ig-cookies and the
// Settings page rewrite this whole array too, so a blind update can clobber
// concurrent changes.
const { data: written, error: writeErr } = await sb
  .from("app_settings")
  .update({ instagram_accounts: accounts })
  .eq("id", 1)
  .eq("updated_at", settingsRow.updated_at)
  .select("id")
  .maybeSingle();

if (writeErr) throw new Error(`write failed: ${writeErr.message}`);
if (!written) throw new Error("settings changed concurrently — nothing written, re-run");
console.log(`\nSaved. instagram_accounts now has ${accounts.length} entries.`);
