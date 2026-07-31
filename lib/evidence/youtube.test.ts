import test from "node:test";
import assert from "node:assert/strict";
import {
  extractUrls,
  parseCompactNumber,
  parseYouTubeRef,
  videoSelectionReason,
} from "./youtube";

test("parses every YouTube reference form that appears in bios", () => {
  assert.deepEqual(parseYouTubeRef("https://www.youtube.com/@jordanblake"), {
    kind: "handle",
    value: "jordanblake",
  });
  assert.deepEqual(parseYouTubeRef("youtube.com/channel/UCabcdefghijk123"), {
    kind: "channel",
    value: "UCabcdefghijk123",
  });
  assert.deepEqual(parseYouTubeRef("https://youtu.be/dQw4w9WgXcQ"), {
    kind: "video",
    value: "dQw4w9WgXcQ",
  });
  assert.deepEqual(parseYouTubeRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), {
    kind: "video",
    value: "dQw4w9WgXcQ",
  });
  assert.deepEqual(parseYouTubeRef("https://youtube.com/c/LegacyName"), {
    kind: "handle",
    value: "LegacyName",
  });
  assert.equal(parseYouTubeRef("https://example.com"), null);
  assert.equal(parseYouTubeRef(null), null);
});

test("selects videos by commercial title relevance, then by recency", () => {
  assert.equal(videoSelectionReason("My $10k Coaching Program Explained", false), "title_match:coaching");
  assert.equal(videoSelectionReason("Free Training: Get Clients", false), "title_match:training");
  assert.equal(videoSelectionReason("Apply to work with me", false), "title_match:work_with_me");
  assert.equal(videoSelectionReason("Random vlog day 4", true), "recent_upload");
  assert.equal(videoSelectionReason("Random vlog day 4", false), null);
});

test("unwraps YouTube redirect links to the real destination", () => {
  const description =
    "Get the free training here: https://www.youtube.com/redirect?event=video_description&q=https%3A%2F%2Fjordanblake.com%2Ffree-training";
  assert.deepEqual(extractUrls(description), ["https://jordanblake.com/free-training"]);
});

test("drops social noise but keeps commercial destinations", () => {
  const description = `
    Apply: https://jordanblake.com/apply
    Follow me on https://instagram.com/jordanblake
    Community: https://www.skool.com/jordan
  `;
  const urls = extractUrls(description);
  assert.ok(urls.includes("https://jordanblake.com/apply"));
  assert.ok(urls.includes("https://www.skool.com/jordan"));
  assert.ok(!urls.some((u) => u.includes("instagram.com")));
});

test("strips trailing punctuation from description URLs", () => {
  assert.deepEqual(extractUrls("Sign up at https://example.com/join."), ["https://example.com/join"]);
});

test("parses compact subscriber counts", () => {
  assert.equal(parseCompactNumber("12.5K subscribers"), 12500);
  assert.equal(parseCompactNumber("1.2M subscribers"), 1200000);
  assert.equal(parseCompactNumber("874 subscribers"), 874);
  assert.equal(parseCompactNumber("no digits"), null);
});
