import test from "node:test";
import assert from "node:assert/strict";
import { containsBotChallenge, pageIsUsable } from "./http";

/*
 * Regression tests for the 2026-08-02 test run, where 12 of 20 leads landed in
 * manual review with "information_funnel is unknown". The cause was not missing
 * evidence — it was readable pages being discarded before the AI ever saw them.
 */

const page = (html: string) => ({
  html,
  finalUrl: "https://example.com",
  redirectChain: ["https://example.com"],
  method: "free_fetch" as const,
});

test("a page that merely loads reCAPTCHA is not a bot challenge", () => {
  // Verbatim from stan.store/lillisophia: "recaptcha" contains "captcha", which
  // a raw-HTML substring match treats as a block.
  const html = `<html><head>
    <script src="https://www.google.com/recaptcha/enterprise.js?render=6LeANSInAAA"></script>
    </head><body><h1>Lilli Sophia</h1>
    <p>${"Book a 1:1 coaching call and get the free guide. ".repeat(20)}</p>
    </body></html>`;
  assert.equal(containsBotChallenge(html), false);
  assert.equal(pageIsUsable(page(html)), true);
});

test("a real Cloudflare interstitial is still detected", () => {
  const html = `<html><body><h1>Just a moment...</h1>
    <p>Checking your browser before accessing the site.</p></body></html>`;
  assert.equal(containsBotChallenge(html), true);
});

test("Cloudflare structural markers are detected even without visible text", () => {
  const html = `<html><head><meta id="cf-browser-verification"></head><body></body></html>`;
  assert.equal(containsBotChallenge(html), true);
});

test("challenge wording inside a script string does not block the page", () => {
  // Analytics and consent tooling routinely ship these phrases as JS strings.
  const html = `<html><head><script>var msg = "access denied";</script></head>
    <body><h1>Pricing</h1><p>${"Our coaching program includes weekly calls. ".repeat(20)}</p></body></html>`;
  assert.equal(containsBotChallenge(html), false);
});

test("a genuine captcha wall shown to the visitor is detected", () => {
  const html = `<html><body><p>Please complete the CAPTCHA to continue.</p></body></html>`;
  assert.equal(containsBotChallenge(html), true);
});
