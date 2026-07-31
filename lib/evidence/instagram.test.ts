import test from "node:test";
import assert from "node:assert/strict";
import {
  computeActivityMetrics,
  normalizeInstagramEvidence,
  usernameFromInstagramUrl,
  type RawInstagramUser,
} from "./instagram";
import { assessSufficiency } from "./sufficiency";

function rawUser(overrides: Partial<RawInstagramUser> = {}): RawInstagramUser {
  return {
    username: "examplecoach",
    full_name: "Example Coach",
    biography: "I help coaches get clients. DM READY",
    external_url: "https://link.me/example",
    category_name: "Entrepreneur",
    is_private: false,
    is_verified: false,
    edge_followed_by: { count: 12000 },
    edge_follow: { count: 500 },
    edge_owner_to_timeline_media: {
      count: 240,
      edges: [
        {
          node: {
            shortcode: "abc1",
            is_video: true,
            video_view_count: 5000,
            edge_liked_by: { count: 200 },
            edge_media_to_comment: { count: 12 },
            edge_media_to_caption: { edges: [{ node: { text: "How to get clients" } }] },
            taken_at_timestamp: Math.floor(Date.now() / 1000) - 3 * 86400,
            pinned_for_users: [],
          },
        },
        {
          node: {
            shortcode: "abc2",
            is_video: true,
            video_view_count: 8000,
            edge_media_to_caption: { edges: [{ node: { text: "Pinned welcome" } }] },
            taken_at_timestamp: Math.floor(Date.now() / 1000) - 10 * 86400,
            pinned_for_users: [{ id: "1" }],
          },
        },
      ],
    },
    ...overrides,
  };
}

test("normalizes a complete profile and separates pinned posts", () => {
  const evidence = normalizeInstagramEvidence({ username: "examplecoach", user: rawUser() });

  assert.equal(evidence.username, "examplecoach");
  assert.equal(evidence.category, "Entrepreneur");
  assert.equal(evidence.profile_capture_status, "captured");
  assert.equal(evidence.recent_posts_capture_status, "captured");
  assert.equal(evidence.pinned_posts_capture_status, "captured");
  assert.equal(evidence.pinned_posts.length, 1);
  assert.equal(evidence.recent_posts.length, 1);
  assert.equal(evidence.recent_posts[0].post_id, "abc1");
});

test("a provider failure marks the profile failed, not empty", () => {
  const evidence = normalizeInstagramEvidence({
    username: "ghost",
    user: null,
    providerError: "ScrapingBee 500",
  });
  assert.equal(evidence.profile_capture_status, "failed");
  assert.equal(evidence.recent_posts_capture_status, "not_attempted");
  assert.equal(assessSufficiency(evidence).verdict, "retryable");
});

test("posts claimed but none returned is unreliable, never a rejection", () => {
  const evidence = normalizeInstagramEvidence({
    username: "examplecoach",
    user: rawUser({ edge_owner_to_timeline_media: { count: 240, edges: [] } }),
  });
  assert.equal(evidence.recent_posts_capture_status, "failed");

  const verdict = assessSufficiency(evidence);
  assert.equal(verdict.data_quality, "unreliable");
  assert.notEqual(verdict.verdict, "excluded");
  assert.ok(verdict.reasons.includes("posts_claimed_but_none_returned"));
});

test("a provider that never reports pinning yields unavailable, not captured-empty", () => {
  const user = rawUser();
  for (const edge of user.edge_owner_to_timeline_media!.edges!) {
    delete edge.node!.pinned_for_users;
  }
  const evidence = normalizeInstagramEvidence({ username: "examplecoach", user });
  assert.equal(evidence.pinned_posts_capture_status, "unavailable");
});

test("story highlights default to not_attempted, never captured-empty", () => {
  const evidence = normalizeInstagramEvidence({ username: "examplecoach", user: rawUser() });
  assert.equal(evidence.story_highlights_capture_status, "not_attempted");
  assert.deepEqual(evidence.story_highlight_titles, []);
});

test("private profile with a bio goes to review, without goes to excluded", () => {
  const withBio = normalizeInstagramEvidence({
    username: "p",
    user: rawUser({ is_private: true, edge_owner_to_timeline_media: { count: 0, edges: [] } }),
  });
  assert.notEqual(assessSufficiency(withBio).verdict, "excluded");

  const bare = normalizeInstagramEvidence({
    username: "p",
    user: rawUser({
      is_private: true,
      biography: "",
      external_url: "",
      edge_owner_to_timeline_media: { count: 0, edges: [] },
    }),
  });
  const verdict = assessSufficiency(bare);
  assert.equal(verdict.verdict, "excluded");
  assert.ok(verdict.reasons.includes("private_profile_no_public_evidence"));
});

test("obvious non-ICP identities are excluded with cited evidence", () => {
  const evidence = normalizeInstagramEvidence({
    username: "dailymemes",
    user: rawUser({ full_name: "Daily Meme Page", username: "dailymemes" }),
  });
  const verdict = assessSufficiency(evidence);
  assert.equal(verdict.verdict, "excluded");
  assert.match(verdict.exclusion_evidence ?? "", /meme page/);
});

test("a coach whose caption mentions memes is not excluded", () => {
  const evidence = normalizeInstagramEvidence({
    username: "examplecoach",
    user: rawUser({ biography: "I post memes about sales. DM me to apply" }),
  });
  assert.equal(assessSufficiency(evidence).verdict, "sufficient");
});

test("reel reach stays unknown below three view samples", () => {
  const evidence = normalizeInstagramEvidence({ username: "examplecoach", user: rawUser() });
  const metrics = computeActivityMetrics(evidence, "complete");
  assert.equal(metrics.median_unpinned_reel_views, null);
  assert.equal(metrics.reel_view_rate, null);
  assert.equal(metrics.posts_last_30_days, 1);
});

test("reel view rate uses the median of at least three samples", () => {
  const user = rawUser();
  user.edge_owner_to_timeline_media!.edges = [1000, 2000, 90000].map((views, i) => ({
    node: {
      shortcode: `v${i}`,
      is_video: true,
      video_view_count: views,
      taken_at_timestamp: Math.floor(Date.now() / 1000) - 86400,
      pinned_for_users: [],
    },
  }));
  const evidence = normalizeInstagramEvidence({ username: "examplecoach", user });
  const metrics = computeActivityMetrics(evidence, "complete");
  // Median, not mean: the 90k outlier must not define the account's reach.
  assert.equal(metrics.median_unpinned_reel_views, 2000);
  assert.ok(Math.abs((metrics.reel_view_rate ?? 0) - 2000 / 12000) < 1e-9);
});

test("missing post data yields null activity rather than zero", () => {
  const evidence = normalizeInstagramEvidence({
    username: "examplecoach",
    user: rawUser({ edge_owner_to_timeline_media: { count: 0 } }),
  });
  const metrics = computeActivityMetrics(evidence, "partial");
  assert.equal(metrics.posts_last_30_days, null);
  assert.equal(metrics.days_since_latest_post, null);
});

test("parses usernames from the URL forms operators paste", () => {
  assert.equal(usernameFromInstagramUrl("https://www.instagram.com/rowellwestra?igsh=abc"), "rowellwestra");
  assert.equal(usernameFromInstagramUrl("instagram.com/tom__youngs/"), "tom__youngs");
  assert.equal(usernameFromInstagramUrl("@keirhubner"), "keirhubner");
  assert.equal(usernameFromInstagramUrl("https://www.instagram.com/p/Cxyz/"), null);
});
