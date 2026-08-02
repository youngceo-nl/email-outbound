/*
 * Writes an API key into the shared app_settings row (id = 1).
 *
 * This is the ONLY sanctioned way to add a credential to this project. Keys must
 * not go into .env.local: this repo is public, the team is more than one person,
 * and a key that lives on one laptop is a key nobody else has. app_settings is
 * RLS-protected (authenticated non-VA only, see 20260726000000_va_role_lockdown)
 * and is what the Settings page already edits.
 *
 * The value is read from STDIN, never argv, so the secret never lands in shell
 * history or in the process list.
 *
 *   echo -n "<key>" | npx tsx scripts/set-api-key.mts steel_api_key
 *   npx tsx scripts/set-api-key.mts --list          # show columns + which are set
 *
 * lib/config/settings.ts is `server-only`, so this talks to Supabase directly
 * rather than importing updateSettings.
 */

import { readFileSync } from "node:fs";

// tsx does not load .env.local the way Next does.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { createAdminClient } = await import("../lib/supabase/admin");
const sb = createAdminClient();

const mask = (v: unknown): string => {
  const s = String(v ?? "");
  if (!s) return "(empty)";
  return s.length <= 8 ? `${s.slice(0, 2)}…` : `${s.slice(0, 6)}…${s.slice(-2)} (${s.length} chars)`;
};

const { data: row, error: readErr } = await sb
  .from("app_settings")
  .select("*")
  .eq("id", 1)
  .single();
if (readErr || !row) {
  console.error(`Could not read app_settings: ${readErr?.message ?? "no row with id = 1"}`);
  process.exit(1);
}

// Only credential-shaped columns, so a typo cannot overwrite an unrelated setting.
const isSecretColumn = (c: string) => /(_key|_keys|_token|_secret|_cookie|_cookies)$/.test(c);
const secretColumns = Object.keys(row).filter(isSecretColumn).sort();

const column = process.argv[2];

if (!column || column === "--list") {
  console.log("Credential columns in app_settings (id = 1):\n");
  for (const c of secretColumns) {
    const v = (row as Record<string, unknown>)[c];
    const set = Array.isArray(v) ? v.length > 0 : !!v;
    console.log(`  ${set ? "set  " : "empty"}  ${c.padEnd(30)} ${set ? mask(Array.isArray(v) ? v[0] : v) : ""}`);
  }
  console.log(`\nUsage: echo -n "<key>" | npx tsx scripts/set-api-key.mts <column>`);
  process.exit(0);
}

if (!secretColumns.includes(column)) {
  console.error(`"${column}" is not a credential column on app_settings.`);
  console.error(`Run with --list to see the ${secretColumns.length} valid columns.`);
  console.error(`If the key needs a new column, add a migration first — this script never creates one.`);
  process.exit(1);
}

const value = readFileSync(0, "utf8").trim();
if (!value) {
  console.error("No value on stdin. Pipe the key in:");
  console.error(`  echo -n "<key>" | npx tsx scripts/set-api-key.mts ${column}`);
  process.exit(1);
}

const previous = (row as Record<string, unknown>)[column];
if (previous && String(previous) === value) {
  console.log(`${column} already holds this value — nothing to do.`);
  process.exit(0);
}

const { error } = await sb
  .from("app_settings")
  .update({ [column]: value })
  .eq("id", 1);
if (error) {
  console.error(`Update failed: ${error.message}`);
  process.exit(1);
}

console.log(`${column} ${previous ? "replaced" : "set"} → ${mask(value)}`);
if (previous) console.log(`  previous value was ${mask(previous)} — rotate it at the provider if it leaked.`);
console.log(`\nEveryone on the team now reads this from app_settings. Do not add it to .env.local.`);
