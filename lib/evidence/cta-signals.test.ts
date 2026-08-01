import test from "node:test";
import assert from "node:assert/strict";
import { collectDirectResponseCtas, detectDirectResponseCtas } from "./cta-signals";
import { youtubeIdentity } from "./youtube";
import { classifyHighlight } from "@/lib/qualification/scorecard";

// ---------------------------------------------------------------------------
// Direct-response CTA detection
//
// Regression: @lukegosseling scored 7.5 instead of 8.5 because a comment-keyword
// funnel was labelled `information_action` — the extractor scored what the
// visitor RECEIVES (a blueprint) rather than how direct the ACTION is.
// ---------------------------------------------------------------------------

test("detects a comment-keyword funnel even when the deliverable is free", () => {
  const ctas = detectDirectResponseCtas(
    `Comment "Pages" and I'll send you the full blueprint I used to gain over 15,000,000 followers`,
    "recent_post:abc",
  );
  assert.equal(ctas.length, 1);
  assert.equal(ctas[0].action, "comment");
  assert.equal(ctas[0].keyword, "Pages");
  assert.match(ctas[0].phrase, /blueprint/);
});

test("detects the comment-the-word phrasing", () => {
  const ctas = detectDirectResponseCtas(
    `Comment the word "IG" if you're ready to go all in on yourself`,
    "pinned_post:xyz",
  );
  assert.equal(ctas[0].action, "comment");
  assert.equal(ctas[0].keyword, "IG");
});

test("detects a DM keyword funnel", () => {
  const ctas = detectDirectResponseCtas('📲 Info? DM: "RUTHLESS"', "bio:profile");
  assert.equal(ctas[0].action, "dm");
  assert.equal(ctas[0].keyword, "RUTHLESS");
});

test("does not mistake a grammatical filler word for the keyword", () => {
  const ctas = detectDirectResponseCtas("DM me for details about coaching", "bio:profile");
  assert.equal(ctas[0].action, "dm");
  assert.equal(ctas[0].keyword, null, '"for" is not a keyword');
});

test("reports both a DM and a comment funnel on the same profile", () => {
  const ctas = collectDirectResponseCtas([
    { text: 'DM "SCALE" to work with me', source: "bio:profile" },
    { text: 'Comment "GROW" for the free training', source: "recent_post:1" },
  ]);
  const actions = ctas.map((cta) => cta.action);
  assert.ok(actions.includes("dm"));
  assert.ok(actions.includes("comment"));
});

test("a bare link or watch invitation is not a direct-response CTA", () => {
  assert.deepEqual(detectDirectResponseCtas("Watch my latest video, link in bio", "bio:profile"), []);
  assert.deepEqual(detectDirectResponseCtas("Follow me for daily content", "bio:profile"), []);
});

test("deduplicates the same keyword funnel repeated across surfaces", () => {
  const ctas = collectDirectResponseCtas([
    { text: 'DM "READY" for coaching', source: "bio:profile" },
    { text: 'DM "READY" for coaching', source: "recent_post:1" },
  ]);
  assert.equal(ctas.length, 1);
});

test("handles empty and missing text", () => {
  assert.deepEqual(detectDirectResponseCtas(null, "bio:profile"), []);
  assert.deepEqual(detectDirectResponseCtas("", "bio:profile"), []);
});

// ---------------------------------------------------------------------------
// YouTube hop identity
//
// Regression: the CTA chain recorded `watch_on_youtube` six times because each
// URL variant of one video canonicalized differently.
// ---------------------------------------------------------------------------

test("URL variants of one video share an identity", () => {
  const identities = [
    "https://www.youtube.com/watch?v=SVM6h593K4c",
    "https://m.youtube.com/watch?v=SVM6h593K4c&t=1240s",
    "https://youtube.com/watch?v=SVM6h593K4c&t=507s&pp=ygUNcm93ZWxs",
    "https://youtu.be/SVM6h593K4c",
  ].map(youtubeIdentity);

  assert.equal(new Set(identities).size, 1, identities.join(" | "));
  assert.equal(identities[0], "video:svm6h593k4c");
});

test("different videos and channels keep distinct identities", () => {
  assert.notEqual(
    youtubeIdentity("https://youtube.com/watch?v=AAAAAAAAAAA"),
    youtubeIdentity("https://youtube.com/watch?v=BBBBBBBBBBB"),
  );
  assert.equal(youtubeIdentity("https://www.youtube.com/@lukegosseling"), "handle:lukegosseling");
  assert.equal(youtubeIdentity("https://example.com/video"), null);
});

// ---------------------------------------------------------------------------
// Highlight grouping
//
// Regression: @glenn.nieuwenhuis has a "students" Highlight that classified as
// no group at all, while an equivalent "clients" folder scored as Proof. For an
// information ICP, student outcomes are the more on-target proof signal.
// ---------------------------------------------------------------------------

test("student and member folders count as proof, like clients", () => {
  assert.equal(classifyHighlight("students"), "proof");
  assert.equal(classifyHighlight("STUDENT WINS"), "proof");
  assert.equal(classifyHighlight("members"), "proof");
  assert.equal(classifyHighlight("clients"), "proof");
});

test("existing highlight groups are unchanged", () => {
  assert.equal(classifyHighlight("RESULTS"), "proof");
  assert.equal(classifyHighlight("TESTIMONIALS"), "proof");
  assert.equal(classifyHighlight("1-1 COACHING"), "offer");
  assert.equal(classifyHighlight("START HERE"), "funnel");
  assert.equal(classifyHighlight("MY STORY"), "authority");
  assert.equal(classifyHighlight("Ibiza 2024"), null);
  assert.equal(classifyHighlight("marbs XXII"), null);
});
