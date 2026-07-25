import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { fetchProspectImage, monogram } from "./prospect-image";

/*
 *   npx tsx --test lib/report/renderer/prospect-image.test.ts
 *
 * No network in these tests: everything asserted here is rejected before a fetch
 * is attempted, which is the point — the URL comes from a scrape, so validation
 * has to happen before the request, not after.
 */

describe("fetchProspectImage rejects before making a request", () => {
  it("refuses a missing url", async () => {
    assert.deepEqual(await fetchProspectImage(null), { ok: false, reason: "missing" });
    assert.deepEqual(await fetchProspectImage(""), { ok: false, reason: "missing" });
  });

  it("refuses anything that is not https", async () => {
    assert.deepEqual(await fetchProspectImage("http://scontent.cdninstagram.com/x.jpg"), {
      ok: false,
      reason: "bad_scheme",
    });
    assert.deepEqual(await fetchProspectImage("file:///etc/passwd"), { ok: false, reason: "bad_scheme" });
    assert.deepEqual(await fetchProspectImage("not a url"), { ok: false, reason: "bad_scheme" });
  });

  it("refuses hosts outside Meta's CDN", async () => {
    for (const url of [
      "https://evil.example.com/x.jpg",
      "https://localhost/x.jpg",
      "https://127.0.0.1/x.jpg",
      "https://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
      "https://10.0.0.1/x.jpg",
    ]) {
      assert.deepEqual(await fetchProspectImage(url), { ok: false, reason: "blocked_host" }, url);
    }
  });

  it("is not fooled by a lookalike hostname", async () => {
    // Suffix matching must be on a dot boundary, or "cdninstagram.com.evil.com"
    // and "notcdninstagram.com" would both slip through.
    assert.deepEqual(await fetchProspectImage("https://scontent.cdninstagram.com.evil.com/x.jpg"), {
      ok: false,
      reason: "blocked_host",
    });
    assert.deepEqual(await fetchProspectImage("https://notcdninstagram.com/x.jpg"), {
      ok: false,
      reason: "blocked_host",
    });
  });

  it("accepts the real CDN hosts as far as the network attempt", async () => {
    // A made-up path on a real host: it must get past validation and fail at the
    // network instead, proving the allowlist is not rejecting legitimate URLs.
    const result = await fetchProspectImage("https://scontent-lhr8-1.cdninstagram.com/v/does-not-exist.jpg");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        ["network", "expired", "wrong_type"].includes(result.reason),
        `expected a post-validation failure, got ${result.reason}`,
      );
    }
  });
});

describe("monogram", () => {
  it("uses initials from a full name", () => {
    assert.equal(monogram("Aaron Alexander", "aaronalexander"), "AA");
    assert.equal(monogram("mary-jane watson", "mj"), "MW");
  });

  it("falls back to the first two characters of a single word", () => {
    assert.equal(monogram("Cher", "cher"), "CH");
  });

  it("falls back to the handle when there is no name", () => {
    assert.equal(monogram("", "breathwork.dan"), "BR");
    assert.equal(monogram("   ", "zed"), "ZE");
  });

  it("never returns an empty string", () => {
    // A blank monogram would render as an empty circle on the cover.
    assert.equal(monogram("", ""), "?");
  });
});
