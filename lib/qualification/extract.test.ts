import test from "node:test";
import assert from "node:assert/strict";

/*
 * The citation phrase check must tolerate separator differences.
 *
 * Regression: a Whop offer page rendered "The 10K Followers RoadmapThe exact
 * step by step..." with no separator; the extractor cited it with " - " between
 * heading and body. Twelve such citations were flagged unverified, which capped
 * certainty at medium and blocked auto-approval on a clean 9.0 lead.
 */
function collapse(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

test("separator differences do not invalidate a faithful citation", () => {
  const pageText = "The 10K Followers RoadmapThe exact step by step sequence to get your first audience.";
  const cited = "The 10K Followers Roadmap - The exact step by step sequence";
  assert.ok(collapse(pageText).includes(collapse(cited)));
});

test("genuinely absent phrases still fail the check", () => {
  const pageText = "FREEDOM is the system for creators who want to grow fast.";
  const invented = "Guaranteed six figures in thirty days";
  assert.ok(!collapse(pageText).includes(collapse(invented)));
});

test("collapsing is case and punctuation insensitive but not word-order insensitive", () => {
  assert.ok(collapse("Weekly Feedback Threads").includes(collapse("weekly feedback")));
  assert.ok(!collapse("Weekly Feedback Threads").includes(collapse("threads weekly feedback")));
});

/*
 * Every captured field quoted into the prompt must also be searchable when
 * verifying citations. Prices were omitted, so citing "$148" — a value the
 * collector had captured — counted as an unverified phrase.
 */
test("prices and signal arrays are citable evidence, not phantom phrases", () => {
  const destination = {
    page_title: "FREEDOM",
    prices: ["$493.33", "$148"],
    proof_claims: ["Went from 10,000 to 400,000 followers"],
    education_delivery_signals: ["This isn't information. It's the exact playbook"],
  };
  const haystack = collapse(
    [
      destination.page_title,
      ...destination.prices,
      ...destination.proof_claims,
      ...destination.education_delivery_signals,
    ].join(" "),
  );

  assert.ok(haystack.includes(collapse("$148")));
  assert.ok(haystack.includes(collapse("$493.33")));
  assert.ok(haystack.includes(collapse("400,000 followers")));
  assert.ok(!haystack.includes(collapse("$999")));
});
