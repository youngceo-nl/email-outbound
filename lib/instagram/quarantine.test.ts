import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedAccount } from "../types";
import { pauseManagedAccount, sanitizeProxyEndpoint, shouldQuarantine } from "./quarantine-policy";

const account = (label: string): ManagedAccount => ({
  id: label,
  label,
  password: "secret",
  totp_secret: null,
  account_email: null,
  cookie: `sessionid=${label}`,
  cookie_set_at: null,
  last_error: null,
  checkpoint_state: null,
  proxy_url: `http://user:password@proxy.example:${label === "one" ? "8001" : "8002"}`,
  steel_profile_id: `steel-${label}`,
  group: "C",
  paused: false,
});

test("pauses only the exact challenged account", () => {
  const original = [account("one"), account("two")];
  const updated = pauseManagedAccount(original, "one", "checkpoint");

  assert.equal(updated[0].paused, true);
  assert.equal(updated[0].last_error, "quarantined: checkpoint");
  assert.deepEqual(updated[1], original[1]);
  assert.notEqual(updated, original);
});

test("throws instead of silently pausing the wrong account", () => {
  assert.throws(() => pauseManagedAccount([account("one")], "missing", "checkpoint"), /not found/i);
});

test("sanitized proxy endpoint never contains credentials", () => {
  const safe = sanitizeProxyEndpoint("http://user:password@disp.oxylabs.io:8001");
  assert.equal(safe, "disp.oxylabs.io:8001");
  assert.doesNotMatch(safe, /user|password|@/);
});

test("quarantines challenges and authentication failures, not ordinary fetch errors", () => {
  assert.equal(shouldQuarantine("challenge", []), true);
  assert.equal(shouldQuarantine("failed", ["HTTP 401"]), true);
  assert.equal(shouldQuarantine("failed", ["HTTP 403"]), true);
  assert.equal(shouldQuarantine("failed", ["navigation timeout"]), false);
});
