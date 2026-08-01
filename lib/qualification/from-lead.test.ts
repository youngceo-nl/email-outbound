import { test } from "node:test";
import assert from "node:assert/strict";
import { instagramEvidenceFromLead, leadHasCapturedProfile } from "./from-lead";
import type { CachedLeadProfile } from "./from-lead";

function lead(overrides: Partial<CachedLeadProfile> = {}): CachedLeadProfile {
  return {
    username: "creator",
    full_name: "A Creator",
    bio: "I teach people things",
    external_link: "https://example.com",
    is_private: false,
    is_verified: false,
    followers: 12_000,
    following: 300,
    posts: 400,
    recent_posts: [
      {
        caption: "how to do the thing",
        likes: 100,
        comments: 5,
        views: null,
        taken_at: "2026-07-01T10:00:00.000Z",
        is_reel: false,
        is_pinned: false,
      },
    ],
    ...overrides,
  };
}

test("an un-backfilled row yields no captured surfaces", () => {
  const evidence = instagramEvidenceFromLead(
    lead({ bio: null, followers: null, posts: null, recent_posts: [] }),
  );

  assert.equal(leadHasCapturedProfile(lead({ bio: null, followers: null, posts: null })), false);
  // "unavailable", not "captured": nothing was ever fetched, so absence of a
  // bio is unknown rather than proven.
  assert.equal(evidence.profile_capture_status, "unavailable");
  assert.equal(evidence.external_link, null);
  assert.notEqual(evidence.external_link_capture_status, "captured");
});

test("a backfilled row captures the profile and its bio link", () => {
  const evidence = instagramEvidenceFromLead(lead());

  assert.equal(evidence.profile_capture_status, "captured");
  assert.equal(evidence.external_link, "https://example.com");
  assert.equal(evidence.followers, 12_000);
  assert.equal(evidence.recent_posts_capture_status, "captured");
  assert.equal(evidence.recent_posts.length, 1);
  assert.equal(evidence.recent_posts[0].caption, "how to do the thing");
});

test("an empty cached post array stays unknown, never an empty capture", () => {
  const evidence = instagramEvidenceFromLead(lead({ recent_posts: [] }));

  // An inactive account and a partial backfill are indistinguishable here.
  // Reporting "captured" would let the scorer conclude this creator posts
  // nothing, which is a fact the cache does not hold.
  assert.equal(evidence.recent_posts_capture_status, "not_attempted");
  assert.equal(evidence.pinned_posts_capture_status, "not_attempted");
});

test("pins stay unknown when the scrape never recorded the flag", () => {
  const withoutFlag = instagramEvidenceFromLead(
    lead({
      recent_posts: [
        { caption: "a", likes: 1, comments: 0, views: null, taken_at: null, is_reel: false },
      ],
    }),
  );
  assert.equal(withoutFlag.recent_posts_capture_status, "captured");
  assert.equal(withoutFlag.pinned_posts_capture_status, "not_attempted");

  const withFlag = instagramEvidenceFromLead(
    lead({
      recent_posts: [
        {
          caption: "pinned one",
          likes: 1,
          comments: 0,
          views: null,
          taken_at: null,
          is_reel: false,
          is_pinned: true,
        },
      ],
    }),
  );
  assert.equal(withFlag.pinned_posts_capture_status, "captured");
  assert.equal(withFlag.pinned_posts.length, 1);
});

test("story highlights are never claimed from cache", () => {
  const evidence = instagramEvidenceFromLead(lead());

  // The backfill does not open the highlight tray. Reporting "unavailable"
  // would assert this creator has no highlights.
  assert.equal(evidence.story_highlights_capture_status, "not_attempted");
  assert.deepEqual(evidence.story_highlight_titles, []);
});

test("a null bio link on a backfilled row is a real absence", () => {
  const evidence = instagramEvidenceFromLead(lead({ external_link: null }));

  assert.equal(evidence.profile_capture_status, "captured");
  assert.equal(evidence.external_link, null);
});
