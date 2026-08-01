import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyHighlightTitle,
  classifyResponseUrl,
  computeFieldCompleteness,
  detectChallenge,
  detectPinned,
  isCommerciallyRelevantHighlight,
  normalizePost,
  parseCompactCount,
  parseHighlightItems,
  parseHighlightTray,
  parsePostsResponse,
  parseProfileResponse,
  sanitizeDeep,
  sanitizeHtmlForDiagnostics,
  sanitizeUrl,
} from "./instagram-parsers";

// ---------------------------------------------------------------------------
// Compact counts
// ---------------------------------------------------------------------------

test("parses the compact counts Instagram renders in the DOM", () => {
  assert.equal(parseCompactCount("46K"), 46000);
  assert.equal(parseCompactCount("1.2M"), 1200000);
  assert.equal(parseCompactCount("2,217"), 2217);
  assert.equal(parseCompactCount("874"), 874);
  assert.equal(parseCompactCount("1.5B"), 1500000000);
  assert.equal(parseCompactCount("46K followers"), 46000);
});

test("an unreadable count is unknown, never zero", () => {
  assert.equal(parseCompactCount(null), null);
  assert.equal(parseCompactCount(""), null);
  assert.equal(parseCompactCount("   "), null);
  assert.equal(parseCompactCount("followers"), null);
});

// ---------------------------------------------------------------------------
// Post normalization across response shapes
// ---------------------------------------------------------------------------

test("normalizes a v1 mobile API item", () => {
  const post = normalizePost({
    pk: "3412345",
    code: "DYKq1UwMGmV",
    media_type: 2,
    product_type: "clips",
    caption: { text: "How I sign consultants" },
    taken_at: 1_753_000_000,
    like_count: 210,
    comment_count: 14,
    play_count: 9100,
    image_versions2: { candidates: [{ url: "https://cdn.example/thumb.jpg?oh=abc&oe=def" }] },
    timeline_pinned_user_ids: [],
  });

  assert.ok(post);
  assert.equal(post.post_id, "3412345");
  assert.equal(post.shortcode, "DYKq1UwMGmV");
  assert.equal(post.url, "https://www.instagram.com/p/DYKq1UwMGmV/");
  assert.equal(post.caption, "How I sign consultants");
  assert.equal(post.media_type, "video");
  assert.equal(post.is_reel, true);
  assert.equal(post.likes, 210);
  assert.equal(post.views, 9100);
  assert.equal(post.is_pinned, false);
  // Signed CDN parameters must not survive into the report.
  assert.ok(!post.thumbnail_url?.includes("oh="));
});

test("normalizes a legacy GraphQL edge node", () => {
  const post = normalizePost({
    node: {
      id: "999",
      shortcode: "ABC123",
      __typename: "GraphVideo",
      is_video: true,
      edge_media_to_caption: { edges: [{ node: { text: "Client win" } }] },
      taken_at_timestamp: 1_752_000_000,
      edge_media_preview_like: { count: 88 },
      edge_media_to_comment: { count: 3 },
      video_view_count: 4200,
      display_url: "https://cdn.example/d.jpg",
      pinned_for_users: [{ id: "1" }],
    },
  });

  assert.ok(post);
  assert.equal(post.post_id, "999");
  assert.equal(post.caption, "Client win");
  assert.equal(post.likes, 88);
  assert.equal(post.views, 4200);
  assert.equal(post.is_video, true);
  assert.equal(post.is_pinned, true);
});

test("a node without any identifier is not evidence", () => {
  assert.equal(normalizePost({ caption: { text: "orphan" } }), null);
  assert.equal(normalizePost(null), null);
  assert.equal(normalizePost("nonsense"), null);
});

test("carousel and image posts are distinguished from video", () => {
  assert.equal(normalizePost({ pk: "1", media_type: 8 })?.media_type, "carousel");
  assert.equal(normalizePost({ pk: "2", media_type: 1 })?.media_type, "image");
  assert.equal(normalizePost({ pk: "3", __typename: "GraphSidecar" })?.media_type, "carousel");
});

// ---------------------------------------------------------------------------
// Pinned detection — the captured/unavailable distinction
// ---------------------------------------------------------------------------

test("pinned detection reports null when the surface carries no marker", () => {
  assert.equal(detectPinned({ pk: "1" }), null, "no marker means unknown, not unpinned");
  assert.equal(detectPinned({ timeline_pinned_user_ids: [] }), false);
  assert.equal(detectPinned({ timeline_pinned_user_ids: ["42"] }), true);
  assert.equal(detectPinned({ pinned_for_users: [] }), false);
  assert.equal(detectPinned({ pinned_for_users: [{ id: "1" }] }), true);
  assert.equal(detectPinned({ is_pinned: true }), true);
});

// ---------------------------------------------------------------------------
// Response extraction
// ---------------------------------------------------------------------------

test("parses a profile from the web_profile_info shape", () => {
  const profile = parseProfileResponse({
    data: {
      user: {
        username: "mikeradoor",
        full_name: "Mike Radoor",
        biography: "I help coaches scale. DM SCALE",
        category_name: "Entrepreneur",
        external_url: "https://example.com/apply?utm_source=ig",
        edge_followed_by: { count: 51000 },
        edge_follow: { count: 812 },
        edge_owner_to_timeline_media: { count: 240 },
        is_verified: false,
        is_private: false,
        profile_pic_url_hd: "https://cdn.example/pic.jpg",
        id: "12345",
      },
    },
  });

  assert.ok(profile);
  assert.equal(profile.username, "mikeradoor");
  assert.equal(profile.followers, 51000);
  assert.equal(profile.following, 812);
  assert.equal(profile.total_posts, 240);
  assert.equal(profile.category, "Entrepreneur");
  assert.equal(profile.is_private, false);
  assert.equal(profile.user_id, "12345");
});

test("parses a profile from the v1 shape with bio_links", () => {
  const profile = parseProfileResponse({
    user: {
      username: "mikeradoor",
      full_name: "Mike Radoor",
      biography: "bio",
      follower_count: 51000,
      following_count: 812,
      media_count: 240,
      bio_links: [{ url: "https://example.com/funnel" }],
      profile_pic_url: "https://cdn.example/p.jpg",
      pk: "999",
    },
  });
  assert.equal(profile?.external_link, "https://example.com/funnel");
  assert.equal(profile?.followers, 51000);
});

test("returns null when no user object exists in the response", () => {
  assert.equal(parseProfileResponse({ data: { something: 1 } }), null);
  assert.equal(parseProfileResponse(null), null);
});

test("collects posts from nested GraphQL and v1 containers alike", () => {
  const posts = parsePostsResponse({
    data: {
      xdt_api__v1__feed__user_timeline_graphql_connection: {
        edges: [
          { node: { pk: "1", code: "AAA", media_type: 1, taken_at: 1_750_000_000 } },
          { node: { pk: "2", code: "BBB", media_type: 2, taken_at: 1_750_100_000 } },
        ],
      },
    },
  });
  assert.equal(posts.length, 2);
  assert.deepEqual(posts.map((p) => p.post_id), ["1", "2"]);
});

test("deduplicates posts that appear in more than one container", () => {
  const posts = parsePostsResponse({
    items: [{ pk: "1", code: "AAA", media_type: 1 }],
    data: { edges: [{ node: { pk: "1", code: "AAA", media_type: 1 } }] },
  });
  assert.equal(posts.length, 1);
});

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

test("groups highlight titles into the report's buckets", () => {
  assert.equal(classifyHighlightTitle("RESULTS"), "Proof");
  assert.equal(classifyHighlightTitle("TESTIMONIALS"), "Proof");
  assert.equal(classifyHighlightTitle("SUCCESS STORIES"), "Proof");
  assert.equal(classifyHighlightTitle("1-1 COACHING"), "Offer");
  assert.equal(classifyHighlightTitle("START HERE"), "Funnel");
  assert.equal(classifyHighlightTitle("MY STORY"), "Authority");
  assert.equal(classifyHighlightTitle("Ibiza 2024"), "Other");
});

test("only commercially relevant folders are worth opening", () => {
  assert.equal(isCommerciallyRelevantHighlight("RESULTS"), true);
  assert.equal(isCommerciallyRelevantHighlight("APPLY"), true);
  assert.equal(isCommerciallyRelevantHighlight("Ibiza 2024"), false);
});

test("parses a highlight tray and normalizes prefixed ids", () => {
  const tray = parseHighlightTray({
    tray: [
      { id: "highlight:17900000000000001", title: "RESULTS", cover_media: { cropped_image_version: { url: "https://cdn.example/c.jpg?oe=1" } } },
      { id: "17900000000000002", title: "Ibiza" },
    ],
  });
  assert.equal(tray.length, 2);
  assert.equal(tray[0].highlight_id, "17900000000000001");
  assert.equal(tray[0].group, "Proof");
  assert.ok(!tray[0].cover_url?.includes("oe="));
  assert.equal(tray[1].group, "Other");
});

test("parses story items with link stickers and swipe-up CTAs", () => {
  const items = parseHighlightItems({
    reels_media: [
      {
        items: [
          {
            pk: "3300000001",
            taken_at: 1_751_000_000,
            media_type: 2,
            accessibility_caption: "Client testimonial",
            story_link_stickers: [
              { story_link: { url: "https://example.com/apply?token=SECRET", link_title: "Apply now" } },
            ],
          },
          {
            pk: "3300000002",
            taken_at: 1_751_100_000,
            media_type: 1,
            story_cta: [{ links: [{ webUri: "https://example.com/book" }] }],
          },
        ],
      },
    ],
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].media_type, "video");
  assert.deepEqual(items[0].visible_text, ["Apply now", "Client testimonial"]);
  // The credential-bearing parameter must be stripped, the URL retained.
  assert.equal(items[0].outbound_urls[0], "https://example.com/apply");
  assert.deepEqual(items[1].outbound_urls, ["https://example.com/book"]);
});

test("a non-story items array is not mistaken for story items", () => {
  assert.deepEqual(parseHighlightItems({ items: [{ pk: "1", code: "AAA" }] }), []);
});

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

test("strips credential-bearing query parameters but keeps the URL", () => {
  assert.equal(
    sanitizeUrl("https://example.com/a?utm_source=ig&sessionid=abc&token=xyz&page=2"),
    "https://example.com/a?utm_source=ig&page=2",
  );
  assert.equal(sanitizeUrl("https://cdn.example/i.jpg?oh=aa&oe=bb"), "https://cdn.example/i.jpg");
});

test("rejects non-HTTP and unparseable URLs", () => {
  assert.equal(sanitizeUrl("javascript:alert(1)"), null);
  assert.equal(sanitizeUrl("not a url"), null);
  assert.equal(sanitizeUrl(null), null);
});

test("redacts credential keys at any nesting depth", () => {
  const sanitized = sanitizeDeep({
    ok: "keep",
    headers: { Cookie: "sessionid=abc", authorization: "Bearer xyz" },
    nested: { deep: { csrftoken: "zzz", visible: 1 } },
  }) as Record<string, unknown>;

  const serialized = JSON.stringify(sanitized);
  assert.ok(!serialized.includes("sessionid=abc"));
  assert.ok(!serialized.includes("Bearer xyz"));
  assert.ok(!serialized.includes("zzz"));
  assert.ok(serialized.includes("keep"));
});

test("truncates oversized bodies rather than writing them whole", () => {
  const big = { blob: "x".repeat(50_000) };
  const sanitized = sanitizeDeep(big, { maxBytes: 1000 }) as Record<string, unknown>;
  assert.equal(sanitized._truncated, true);
  assert.ok((JSON.stringify(sanitized)?.length ?? 0) < 2000);
});

test("strips scripts and session state from diagnostic HTML", () => {
  const html = `<html><script>window.__d={sessionid:"abc"}</script><body>csrf_token="zzz"<p>hi</p></body></html>`;
  const clean = sanitizeHtmlForDiagnostics(html);
  assert.ok(!clean.includes("window.__d"));
  assert.ok(!clean.includes("zzz"));
  assert.ok(clean.includes("<p>hi</p>"));
});

// ---------------------------------------------------------------------------
// Routing, completeness, challenges
// ---------------------------------------------------------------------------

test("routes Instagram responses to the right parser", () => {
  assert.equal(classifyResponseUrl("https://www.instagram.com/api/v1/users/web_profile_info/?username=x"), "profile");
  assert.equal(classifyResponseUrl("https://i.instagram.com/api/v1/feed/user/123/"), "timeline");
  assert.equal(classifyResponseUrl("https://i.instagram.com/api/v1/highlights/123/highlights_tray/"), "highlight_tray");
  assert.equal(classifyResponseUrl("https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=highlight:1"), "highlight_items");
  assert.equal(classifyResponseUrl("https://www.instagram.com/graphql/query", "doc_id=1&fn=PolarisProfilePostsQuery"), "timeline");
  assert.equal(classifyResponseUrl("https://www.instagram.com/static/bundle.js"), "other");
});

test("missing means read-and-absent; unknown means acquisition failed", () => {
  const result = computeFieldCompleteness({
    present: { "profile.username": true, "profile.biography": true },
    surfaceStatus: { profile: "captured", posts: "failed", highlights: "not_attempted", external: "captured" },
    fieldSurface: {
      "profile.username": "profile",
      "profile.biography": "profile",
      "profile.category": "profile",
      "recent_posts": "posts",
      "highlights.titles": "highlights",
    },
  });

  assert.ok(result.captured_fields.includes("profile.username"));
  // The profile surface WAS read, so a missing category is a real absence.
  assert.ok(result.missing_fields.includes("profile.category"));
  // The posts surface failed, so nothing can be concluded about it.
  assert.ok(result.unknown_fields.includes("recent_posts"));
  assert.ok(result.unknown_fields.includes("highlights.titles"));
  assert.ok(!result.missing_fields.includes("recent_posts"));
});

test("detects Instagram challenge surfaces without attempting to bypass them", () => {
  assert.equal(detectChallenge("https://www.instagram.com/challenge/", ""), "checkpoint");
  assert.equal(detectChallenge("https://www.instagram.com/accounts/login/?next=/x/", ""), "login_required");
  assert.equal(detectChallenge("https://www.instagram.com/x/", "Please wait a few minutes before you try again."), "rate_limited");
  assert.equal(detectChallenge("https://www.instagram.com/x/", "Confirm you're a human"), "captcha");
  assert.equal(detectChallenge("https://www.instagram.com/mikeradoor/", "Mike Radoor posts"), "none");
});
