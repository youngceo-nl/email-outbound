import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings, ManagedAccount } from "../types";
import { buildAcquisitionPool } from "./cookie-pool";

function account(
  label: string,
  overrides: Partial<ManagedAccount> = {},
): ManagedAccount {
  return {
    id: label,
    label,
    password: "unused",
    totp_secret: null,
    account_email: null,
    cookie: null,
    cookie_set_at: null,
    last_error: null,
    checkpoint_state: null,
    proxy_url: null,
    group: "C",
    paused: false,
    ...overrides,
  };
}

function settingsWith(
  instagram_accounts: ManagedAccount[],
  overrides: Partial<AppSettings> = {},
): AppSettings {
  return {
    active_account_group: "C",
    instagram_accounts,
    instagram_proxy_pool: [],
    instagram_proxy_url: null,
    instagram_session_cookies: [],
    instagram_session_cookie: null,
    ...overrides,
  } as AppSettings;
}

test("includes only active accounts with a complete fixed identity", () => {
  const pool = buildAcquisitionPool(
    settingsWith([
      account("complete", {
        cookie: "sessionid=a",
        proxy_url: "http://proxy-one",
        steel_profile_id: "11111111-1111-4111-8111-111111111111",
      }),
      account("no-proxy", {
        cookie: "sessionid=b",
        steel_profile_id: "22222222-2222-4222-8222-222222222222",
      }),
      account("paused", {
        cookie: "sessionid=c",
        proxy_url: "http://proxy-three",
        steel_profile_id: "33333333-3333-4333-8333-333333333333",
        paused: true,
      }),
      account("other-group", {
        cookie: "sessionid=d",
        proxy_url: "http://proxy-four",
        steel_profile_id: "44444444-4444-4444-8444-444444444444",
        group: "D",
      }),
    ]),
  );

  assert.deepEqual(pool, [
    {
      cookie: "sessionid=a",
      proxyUrl: "http://proxy-one",
      accountUsername: "complete",
      steelProfileId: "11111111-1111-4111-8111-111111111111",
    },
  ]);
});

test("never borrows a positional or global proxy", () => {
  const pool = buildAcquisitionPool(
    settingsWith(
      [
        account("incomplete", {
          cookie: "sessionid=a",
          steel_profile_id: "11111111-1111-4111-8111-111111111111",
        }),
      ],
      {
        instagram_proxy_pool: ["http://shared"],
        instagram_proxy_url: "http://global",
      },
    ),
  );

  assert.equal(pool.length, 0);
});

test("deduplicates a cookie without mixing the second account identity", () => {
  const pool = buildAcquisitionPool(
    settingsWith([
      account("first", {
        cookie: "sessionid=same",
        proxy_url: "http://proxy-one",
        steel_profile_id: "11111111-1111-4111-8111-111111111111",
      }),
      account("second", {
        cookie: "sessionid=same",
        proxy_url: "http://proxy-two",
        steel_profile_id: "22222222-2222-4222-8222-222222222222",
      }),
    ]),
  );

  assert.equal(pool.length, 1);
  assert.equal(pool[0].accountUsername, "first");
  assert.equal(pool[0].proxyUrl, "http://proxy-one");
});
