import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings, ManagedAccount } from "../lib/types";
import { buildProductionIdentityUpdate } from "./configure-production-identities-lib";

const labels = [
  "masakonjoku61",
  "bethannbuczek1",
  "allinedowho",
  "jeanettaze",
  "ilenekawchpw",
  "livelypageant8",
];

function account(label: string): ManagedAccount {
  return {
    id: label,
    label,
    password: "password",
    totp_secret: null,
    account_email: null,
    cookie: `sessionid=${label}`,
    cookie_set_at: null,
    last_error: null,
    checkpoint_state: null,
    proxy_url: null,
    steel_profile_id: null,
    group: "C",
    paused: false,
  };
}

const settings = {
  instagram_accounts: labels.map(account),
  instagram_proxy_pool: ["http://legacy"],
  active_account_group: "C",
} as AppSettings;

const env = {
  OXYLABS_PROXY_1: "http://user:pass@disp.oxylabs.io:8001",
  OXYLABS_PROXY_2: "http://user:pass@disp.oxylabs.io:8002",
  OXYLABS_PROXY_3: "http://user:pass@disp.oxylabs.io:8003",
};

test("maps the three approved accounts and pauses every other group C account", () => {
  const update = buildProductionIdentityUpdate(settings, env);
  const active = update.instagram_accounts.filter((item) => !item.paused);
  assert.deepEqual(active.map((item) => item.label), labels.slice(0, 3));
  assert.deepEqual(active.map((item) => new URL(item.proxy_url!).port), ["8001", "8002", "8003"]);
  assert.ok(active.every((item) => item.cookie && item.steel_profile_id));
  assert.deepEqual(update.instagram_proxy_pool, []);
  assert.equal(update.backfill_cancel_requested, false);
  assert.equal(update.backfill_started_at, null);
});

test("refuses to configure when an approved cookie is missing", () => {
  const broken = {
    ...settings,
    instagram_accounts: settings.instagram_accounts.map((item) =>
      item.label === "bethannbuczek1" ? { ...item, cookie: null } : item,
    ),
  };
  assert.throws(() => buildProductionIdentityUpdate(broken, env), /cookie.*bethannbuczek1/i);
});

test("refuses to configure when a required proxy is missing", () => {
  assert.throws(
    () => buildProductionIdentityUpdate(settings, { ...env, OXYLABS_PROXY_2: undefined }),
    /OXYLABS_PROXY_2/,
  );
});
