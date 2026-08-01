import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAcquisitionStatus,
  validateAcquisitionIdentity,
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
