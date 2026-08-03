import assert from "node:assert/strict";
import test from "node:test";
import {
  AcquisitionTimeoutError,
  classifyAcquisitionStatus,
  validateAcquisitionIdentity,
  withTimeout,
} from "./steel-acquisition";

test("rejects an incomplete identity before creating a Steel session", () => {
  assert.throws(
    () =>
      validateAcquisitionIdentity({
        cookie: "",
        proxyUrl: "http://proxy",
        accountUsername: "account",
        steelProfileId: "11111111-1111-4111-8111-111111111111",
      }),
    /complete acquisition identity/,
  );
});

test("accepts a complete fixed identity without rewriting it", () => {
  const identity = {
    cookie: "sessionid=approved",
    proxyUrl: "http://proxy",
    accountUsername: "account",
    steelProfileId: "11111111-1111-4111-8111-111111111111",
  };
  assert.deepEqual(validateAcquisitionIdentity(identity), identity);
});

test("classifies a detected challenge as terminal for this acquisition", () => {
  assert.equal(
    classifyAcquisitionStatus({
      authenticated: true,
      challenge: "checkpoint",
      profileCaptured: false,
      errors: [],
    }),
    "challenge",
  );
});

test("classifies an authenticated captured profile as captured", () => {
  assert.equal(
    classifyAcquisitionStatus({
      authenticated: true,
      challenge: "none",
      profileCaptured: true,
      errors: [],
    }),
    "captured",
  );
});

test("does not claim capture when authentication failed", () => {
  assert.equal(
    classifyAcquisitionStatus({
      authenticated: false,
      challenge: "none",
      profileCaptured: true,
      errors: ["authentication_required"],
    }),
    "failed",
  );
});

test("withTimeout rejects with the caller's error once the bound is exceeded", async () => {
  /*
   * Regression for 2026-08-03: a self-hosted Steel instance degraded across
   * ~13 sequential real sessions (10s -> 63s, then sub-2s fast failures right
   * before it crashed) with nothing on our side bounding how long a single
   * acquisition could run. acquireInstagramEvidence wraps the real Steel call
   * in exactly this primitive — proving it here avoids mocking the whole
   * Playwright/Steel chain to exercise the one thing that actually changed.
   */
  const hung = new Promise(() => {}); // never resolves — models a stuck session
  await assert.rejects(
    withTimeout(hung, 20, () => new AcquisitionTimeoutError("stuck_profile", 20)),
    (err: unknown) => {
      assert.ok(err instanceof AcquisitionTimeoutError);
      assert.match((err as Error).message, /stuck_profile/);
      return true;
    },
  );
});

test("withTimeout resolves normally when the work finishes first", async () => {
  await assert.doesNotReject(withTimeout(Promise.resolve("done"), 50, () => new Error("should not fire")));
});

test("AcquisitionTimeoutError is a distinct type from a real acquisition failure", () => {
  /*
   * shouldQuarantine (lib/instagram/quarantine-policy.ts) must never fire on
   * this error — a timeout says nothing about the account's cookie or proxy,
   * unlike a real Instagram challenge or block.
   */
  const err = new AcquisitionTimeoutError("someone", 90_000);
  assert.equal(err.name, "AcquisitionTimeoutError");
  assert.match(err.message, /90s/);
});
