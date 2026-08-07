import test from "node:test";
import assert from "node:assert/strict";
import { computeFunnelMaturitySignals } from "./funnel-maturity";
import type {
  ExternalDestination,
  FunnelMaturitySignalKind,
  InstagramEvidence,
} from "@/lib/qualification/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function instagram(overrides: Partial<InstagramEvidence> = {}): InstagramEvidence {
  return {
    username: "example",
    display_name: "Example",
    category: null,
    bio: "Just an ordinary bio with nothing notable in it.",
    external_link: "https://example.com",
    is_private: false,
    is_verified: false,
    followers: 20000,
    following: 400,
    total_posts: 300,
    instagram_meta_description: null,
    profile_extraction_method: "provider",
    profile_capture_status: "captured",
    profile_captured_at: "2026-08-06T10:00:00Z",
    external_link_capture_status: "captured",
    recent_posts: [],
    recent_posts_capture_status: "captured",
    pinned_posts: [],
    pinned_posts_capture_status: "captured",
    story_highlight_titles: [],
    story_highlights_capture_status: "not_attempted",
    story_highlights_captured_at: null,
    ...overrides,
  };
}

function destination(overrides: Partial<ExternalDestination> = {}): ExternalDestination {
  return {
    destination_id: "destination_0",
    source_url: "https://example.com/page",
    final_url: "https://example.com/page",
    redirect_chain: [],
    visible_label: null,
    page_title: "A page",
    meta_description: null,
    headings: [],
    cta_labels: [],
    offer_copy: [],
    prices: [],
    destination_type: "unknown",
    candidate_types: [],
    classification_state: "unknown",
    form_signals: [],
    service_delivery_signals: [],
    education_delivery_signals: [],
    proof_claims: [],
    visitor_receives: ["unknown"],
    commercial_relevance: "primary",
    selection_reason: "instagram bio external link",
    rank: 0,
    hop: 0,
    text_excerpt: null,
    capture_status: "captured",
    capture_method: "free_fetch",
    captured_at: "2026-08-06T10:00:00Z",
    error: null,
    ...overrides,
  };
}

/** Mirrors how lib/evidence/collect.ts derives this flag from destinations. */
function withTracking(destinations: ExternalDestination[]): boolean {
  return destinations.some((d) => (d.tracking_signals?.length ?? 0) > 0);
}

function compute(opts: { instagram?: InstagramEvidence; destinations?: ExternalDestination[] }) {
  const destinations = opts.destinations ?? [];
  return computeFunnelMaturitySignals({
    instagram: opts.instagram ?? instagram(),
    destinations,
    snapshotHasTrackingSignals: withTracking(destinations),
  });
}

function statusOf(signals: ReturnType<typeof compute>, kind: FunnelMaturitySignalKind) {
  return signals.find((s) => s.kind === kind);
}

const ALL_KINDS: FunnelMaturitySignalKind[] = [
  "name_field_positioning",
  "bio_promise",
  "application_funnel",
  "webinar_funnel",
  "booking_funnel",
  "results_highlight",
  "start_here_highlight",
  "offer_highlight",
  "pinned_proof_or_intro",
  "lead_magnet",
  "retargeting",
  "multiple_ctas",
  "branded_methodology",
];

// ---------------------------------------------------------------------------
// Baseline: an ordinary, unremarkable profile trips nothing
// ---------------------------------------------------------------------------

test("a plain profile with no destinations has every signal absent and uncited", () => {
  const signals = compute({});
  assert.equal(signals.length, ALL_KINDS.length);
  for (const kind of ALL_KINDS) {
    const s = statusOf(signals, kind);
    assert.ok(s, `missing signal kind ${kind}`);
    assert.equal(s.present, false, `${kind} should be absent`);
    assert.deepEqual(s.evidence, [], `${kind} should carry no evidence when absent`);
  }
});

// ---------------------------------------------------------------------------
// Each signal firing
// ---------------------------------------------------------------------------

test("name_field_positioning fires on a role word in the display name", () => {
  const signals = compute({ instagram: instagram({ display_name: "Jane Doe | Business Coach" }) });
  const s = statusOf(signals, "name_field_positioning")!;
  assert.equal(s.present, true);
  assert.equal(s.evidence[0].source_type, "display_name");
});

test("name_field_positioning stays absent for a plain name", () => {
  const signals = compute({ instagram: instagram({ display_name: "Jane Doe" }) });
  assert.equal(statusOf(signals, "name_field_positioning")!.present, false);
});

test("bio_promise fires on an 'I help' style bio", () => {
  const signals = compute({ instagram: instagram({ bio: "I help consultants get premium clients." }) });
  const s = statusOf(signals, "bio_promise")!;
  assert.equal(s.present, true);
  assert.equal(s.evidence[0].source_type, "bio");
});

test("application_funnel fires only on a captured application destination", () => {
  const captured = compute({ destinations: [destination({ destination_type: "application" })] });
  assert.equal(statusOf(captured, "application_funnel")!.present, true);

  const failed = compute({
    destinations: [destination({ destination_type: "application", capture_status: "failed" })],
  });
  assert.equal(statusOf(failed, "application_funnel")!.present, false);
});

test("booking_funnel fires only on a captured booking destination", () => {
  const signals = compute({ destinations: [destination({ destination_type: "booking" })] });
  assert.equal(statusOf(signals, "booking_funnel")!.present, true);
});

test("webinar_funnel fires on webinar/masterclass/free-training language in page content", () => {
  const signals = compute({
    destinations: [destination({ page_title: "Join My Free Masterclass This Week" })],
  });
  const s = statusOf(signals, "webinar_funnel")!;
  assert.equal(s.present, true);
  assert.match(s.evidence[0].phrase, /masterclass/i);
});

test("lead_magnet fires only on a captured lead_magnet destination", () => {
  const signals = compute({ destinations: [destination({ destination_type: "lead_magnet" })] });
  assert.equal(statusOf(signals, "lead_magnet")!.present, true);
});

test("results_highlight fires on a Proof-group highlight or a title containing 'result'", () => {
  const byGroup = compute({
    instagram: instagram({
      story_highlights: [{ highlight_id: "h1", title: "CLIENTS", group: "Proof", cover_url: null }],
    }),
  });
  assert.equal(statusOf(byGroup, "results_highlight")!.present, true);

  const byTitle = compute({
    instagram: instagram({
      story_highlights: [{ highlight_id: "h1", title: "RESULTS", group: "Other", cover_url: null }],
    }),
  });
  assert.equal(statusOf(byTitle, "results_highlight")!.present, true);
});

test("start_here_highlight fires on a literal 'start here' title", () => {
  const signals = compute({
    instagram: instagram({
      story_highlights: [{ highlight_id: "h1", title: "START HERE", group: "Other", cover_url: null }],
    }),
  });
  const s = statusOf(signals, "start_here_highlight")!;
  assert.equal(s.present, true);
  assert.equal(s.evidence[0].source_type, "highlight");
});

test("offer_highlight fires on an Offer-group highlight", () => {
  const signals = compute({
    instagram: instagram({
      story_highlights: [{ highlight_id: "h1", title: "COACHING", group: "Offer", cover_url: null }],
    }),
  });
  assert.equal(statusOf(signals, "offer_highlight")!.present, true);
});

test("pinned_proof_or_intro fires whenever any post is pinned", () => {
  const signals = compute({
    instagram: instagram({
      pinned_posts: [{ post_id: "p1", caption: "My story", taken_at: null, is_video: false, is_pinned: true, likes: null, comments: null, views: null }],
    }),
  });
  const s = statusOf(signals, "pinned_proof_or_intro")!;
  assert.equal(s.present, true);
  assert.equal(s.evidence[0].source_type, "pinned_post");
});

test("retargeting mirrors snapshotHasTrackingSignals and cites the tracking destination", () => {
  const signals = compute({
    destinations: [destination({ tracking_signals: ["meta_pixel"] })],
  });
  const s = statusOf(signals, "retargeting")!;
  assert.equal(s.present, true);
  assert.match(s.evidence[0].phrase, /meta_pixel/);
});

test("multiple_ctas requires at least two CTA labels across all destinations combined", () => {
  const one = compute({
    destinations: [destination({ cta_labels: [{ label: "Apply", url: null }] })],
  });
  assert.equal(statusOf(one, "multiple_ctas")!.present, false);

  const two = compute({
    destinations: [
      destination({ destination_id: "d0", cta_labels: [{ label: "Apply", url: null }] }),
      destination({ destination_id: "d1", cta_labels: [{ label: "Book a call", url: null }] }),
    ],
  });
  assert.equal(statusOf(two, "multiple_ctas")!.present, true);
});

test("branded_methodology fires on a Named Method style phrase in the bio", () => {
  const signals = compute({
    instagram: instagram({ bio: "Built with the Client Acceleration Method." }),
  });
  const s = statusOf(signals, "branded_methodology")!;
  assert.equal(s.present, true);
  assert.equal(s.evidence[0].source_type, "bio");
});

test("branded_methodology falls back to destination content when the bio has none", () => {
  const signals = compute({
    destinations: [destination({ page_title: "The Client Acceleration Framework" })],
  });
  const s = statusOf(signals, "branded_methodology")!;
  assert.equal(s.present, true);
  assert.equal(s.evidence[0].source_type, "external_page");
});

test("branded_methodology does not fire on an ordinary capitalized phrase with no method/framework/system word", () => {
  const signals = compute({ instagram: instagram({ bio: "Founder of The Client Acceleration Program." }) });
  assert.equal(statusOf(signals, "branded_methodology")!.present, false);
});

// ---------------------------------------------------------------------------
// A profile hitting every signal at once
// ---------------------------------------------------------------------------

test("a fully mature funnel profile trips all thirteen signals, each cited", () => {
  const signals = compute({
    instagram: instagram({
      display_name: "Jane Doe | Business Coach",
      bio: "I help consultants get premium clients with the Client Acceleration Method.",
      pinned_posts: [{ post_id: "p1", caption: "intro", taken_at: null, is_video: false, is_pinned: true, likes: null, comments: null, views: null }],
      story_highlights: [
        { highlight_id: "h1", title: "START HERE", group: "Other", cover_url: null },
        { highlight_id: "h2", title: "RESULTS", group: "Proof", cover_url: null },
        { highlight_id: "h3", title: "COACHING", group: "Offer", cover_url: null },
      ],
    }),
    destinations: [
      destination({
        destination_id: "d0",
        destination_type: "application",
        page_title: "Free Masterclass",
        cta_labels: [{ label: "Apply", url: null }],
        tracking_signals: ["meta_pixel"],
      }),
      destination({ destination_id: "d1", destination_type: "booking", cta_labels: [{ label: "Book a call", url: null }] }),
      destination({ destination_id: "d2", destination_type: "lead_magnet" }),
    ],
  });

  for (const kind of ALL_KINDS) {
    const s = statusOf(signals, kind)!;
    assert.equal(s.present, true, `expected ${kind} to be present`);
    assert.ok(s.evidence.length > 0, `expected ${kind} to carry evidence`);
  }
});

test("a snapshot with no highlights at all (story_highlights undefined) does not throw", () => {
  const signals = compute({ instagram: instagram({ story_highlights: undefined }) });
  assert.equal(statusOf(signals, "results_highlight")!.present, false);
  assert.equal(statusOf(signals, "offer_highlight")!.present, false);
});
