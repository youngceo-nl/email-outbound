import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProxyUrl, toPlaywrightProxy, proxyFetch } from "./proxy";

test("a bare host:port gains a scheme", () => {
  assert.equal(normalizeProxyUrl("disp.oxylabs.io:8001"), "http://disp.oxylabs.io:8001");
  assert.equal(normalizeProxyUrl("http://disp.oxylabs.io:8001"), "http://disp.oxylabs.io:8001");
  assert.equal(normalizeProxyUrl("https://disp.oxylabs.io:8001"), "https://disp.oxylabs.io:8001");
});

test("credentials are split out of the server URL for Playwright", () => {
  const proxy = toPlaywrightProxy("http://user1:secret@disp.oxylabs.io:8001");

  assert.deepEqual(proxy, {
    server: "http://disp.oxylabs.io:8001",
    username: "user1",
    password: "secret",
  });
});

test("percent-encoded credentials are decoded", () => {
  // Oxylabs passwords routinely contain characters that must be encoded in a URL.
  const proxy = toPlaywrightProxy("http://user%40mail:p%40ss%3Aword@disp.oxylabs.io:8002");

  assert.equal(proxy?.username, "user@mail");
  assert.equal(proxy?.password, "p@ss:word");
  assert.equal(proxy?.server, "http://disp.oxylabs.io:8002");
});

test("an unauthenticated proxy omits credentials rather than sending empty ones", () => {
  const proxy = toPlaywrightProxy("http://disp.oxylabs.io:8003");

  assert.deepEqual(proxy, { server: "http://disp.oxylabs.io:8003" });
});

test("no proxy configured yields null, never a half-built config", () => {
  assert.equal(toPlaywrightProxy(null), null);
  assert.equal(toPlaywrightProxy(undefined), null);
  assert.equal(toPlaywrightProxy("   "), null);
});

test("proxyFetch falls back to plain fetch when unconfigured", () => {
  // The fallback must still be callable — an account with no proxy assigned
  // has to keep working rather than throwing at login time.
  assert.equal(typeof proxyFetch(null), "function");
  assert.equal(typeof proxyFetch(""), "function");
  assert.equal(typeof proxyFetch("http://user:pass@disp.oxylabs.io:8001"), "function");
});
