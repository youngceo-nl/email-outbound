import test from "node:test";
import assert from "node:assert/strict";
import { applyIcpGates } from "./icp-gates";
import type { VisualIdentityResult } from "./visual-identity";
import type { CommercialExtraction, EvidenceSnapshot, SignalState } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cite = () => [
  { source_type: "bio" as const, source_id: "profile", url: null, field: "bio", phrase: "I help consultants get premium clients" },
];

function snapshot(
  overrides: Partial<EvidenceSnapshot["instagram"]> = {},
  snapshotOverrides: Partial<EvidenceSnapshot> = {},
): EvidenceSnapshot {
  return {
    snapshot_id: "snap_1",
    lead_id: null,
    username: "example",
    captured_at: "2026-08-06T10:00:00Z",
    instagram: {
      username: "example",
      display_name: "Example Coach",
      category: null,
      bio: "I help consultants get premium clients",
      external_link: "https://example.com/coaching",
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
    },
    external_destinations: [],
    external_capture_status: "captured",
    youtube_channels: [],
    youtube_videos: [],
    cta_chain: [],
    primary_cta: "apply",
    ultimate_cta: "apply",
    offer_inventory_seed: [],
    proof_inventory_seed: [],
    direct_response_ctas: [],
    acquisition_stop_reason: "ultimate_outcome_resolved",
    acquisition_sufficiency: "sufficient",
    unknown_surfaces: [],
    hops_used: 1,
    activity: {
      data_quality: "complete",
      median_unpinned_reel_views: 5000,
      reel_view_rate: 0.25,
      posts_last_30_days: 8,
      reels_last_30_days: 6,
      days_since_latest_post: 2,
      median_likes_per_follower: 0.01,
    },
    versions: { acquisition_version: "acquisition-1.1.0", fixture_revision: "fixtures-2026-08-06" },
    ...snapshotOverrides,
  };
}

function extraction(overrides: Partial<CommercialExtraction> = {}): CommercialExtraction {
  return {
    extraction_prompt_version: "personal-brand-evidence-v2",
    evidence_snapshot_id: "snap_1",
    human_personal_brand: { state: "present", strength: "strong", evidence: cite() },
    coach_or_consultant: { state: "present", strength: "strong", evidence: cite() },
    audience: { label: "explicit", value: "consultants", evidence: cite() },
    transformation: {
      state: "present", strength: "strong", label: "explicit_result",
      outcome: "get premium clients", evidence: cite(),
    },
    information_funnel: {
      state: "present", strength: "credible", label: "visible_offer",
      visitor_receives: ["coaching"], asset_or_offer: "1:1 coaching", evidence: cite(),
    },
    cta: {
      state: "present", strength: "strong", label: "direct_sales_action",
      action: "apply", token_or_asset: null, evidence: cite(),
    },
    proof: { state: "present", strength: "strong", label: "strong", claims: [], evidence: cite() },
    authority: { state: "present", strength: "credible", label: "credible", types: ["specialization"], evidence: cite() },
    business_models: [{ type: "information_education", prominence: "primary", evidence: cite() }],
    offers: [
      {
        offer_id: "offer_1",
        name: "1:1 coaching",
        type: "coaching",
        prominence: "primary",
        audience: "consultants",
        delivery: "private coaching",
        visitor_receives: ["coaching"],
        customer_implementation_role: "implements_with_guidance",
        price: "$500/mo",
        cta: "apply",
        is_paid: "paid",
        active_status: "active",
        evidence: cite(),
      },
    ],
    proof_attribution: [],
    primary_visitor_outcome: "coaching",
    primary_cta: "apply",
    ultimate_cta: "apply for coaching",
    cta_chain_resolved: true,
    acquisition_sufficiency: "sufficient",
    agency_evidence_bundle: { service_delivery: [], team_performance: [], service_cta: [], reliability: "absent" },
    agency_service_evidence: [],
    exclusion_evidence: [],
    conflicts: [],
    data_quality: "complete",
    unknown_surfaces: [],
    ...overrides,
  };
}

function visionResult(individualVisible: SignalState, recurring: SignalState = individualVisible): VisualIdentityResult {
  return {
    ok: true,
    facts: {
      individual_visible: individualVisible === "conflicting" ? "unknown" : (individualVisible as "present" | "absent" | "unknown"),
      recurring_individual: recurring === "conflicting" ? "unknown" : (recurring as "present" | "absent" | "unknown"),
      images_with_person: individualVisible === "present" ? 3 : 0,
      images_examined: 3,
      appears_faceless_or_stock: individualVisible === "absent",
      notes: "",
      evidence: individualVisible === "present" || recurring === "present"
        ? [{ source_type: "profile_image", source_id: "profile", phrase: "a person" }]
        : [],
    },
    vision_prompt_version: "gate2-visual-identity-v1",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    usage: { inputTokens: 100, outputTokens: 20 },
    repaired: false,
  };
}

function destination(overrides: Partial<EvidenceSnapshot["external_destinations"][number]> = {}): EvidenceSnapshot["external_destinations"][number] {
  return {
    destination_id: "destination_0",
    source_url: "https://example.com/apply",
    final_url: "https://example.com/apply",
    redirect_chain: [],
    visible_label: "Apply Now",
    page_title: "Apply",
    meta_description: null,
    headings: [],
    cta_labels: [],
    offer_copy: [],
    prices: [],
    destination_type: "application",
    candidate_types: ["application"],
    classification_state: "resolved",
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

const noVision: VisualIdentityResult = {
  ok: true,
  facts: null,
  vision_prompt_version: "gate2-visual-identity-v1",
  provider: null,
  model: null,
  usage: { inputTokens: 0, outputTokens: 0 },
  repaired: false,
};

// ---------------------------------------------------------------------------
// Gate 1 — Minimum Audience Size
// ---------------------------------------------------------------------------

test("a coach with 4,900 followers is rejected under the strict threshold", () => {
  const result = applyIcpGates({
    snapshot: snapshot({ followers: 4900 }),
    extraction: extraction(),
    visualIdentity: noVision,
  });
  assert.equal(result.follower_gate, "fail");
  assert.equal(result.outcome, "reject");
  assert.equal(result.rejection_reason, "follower_below_minimum");
});

test("5,000 followers exactly clears the gate", () => {
  const result = applyIcpGates({
    snapshot: snapshot({ followers: 5000 }),
    extraction: extraction(),
    visualIdentity: noVision,
  });
  assert.equal(result.follower_gate, "pass");
});

test("an uncaptured follower count is unknown, not a reject or a pass", () => {
  const result = applyIcpGates({
    snapshot: snapshot({ followers: null }),
    extraction: extraction(),
    visualIdentity: noVision,
  });
  assert.equal(result.follower_gate, "unknown");
  assert.equal(result.outcome, "manual_review");
  assert.ok(result.review_reasons.includes("follower_count_unknown"));
});

// ---------------------------------------------------------------------------
// Gate 2 — Personal Brand (text + vision)
// ---------------------------------------------------------------------------

test("text present passes regardless of what vision says", () => {
  for (const vision of [noVision, visionResult("absent"), visionResult("unknown")]) {
    const result = applyIcpGates({
      snapshot: snapshot(),
      extraction: extraction({ human_personal_brand: { state: "present", strength: "strong", evidence: cite() } }),
      visualIdentity: vision,
    });
    assert.equal(result.personal_brand.status, "pass");
  }
});

test("vision alone can pass Gate 2 when text could not establish it", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({ human_personal_brand: { state: "unknown", strength: "absent", evidence: [] } }),
    visualIdentity: visionResult("present"),
  });
  assert.equal(result.personal_brand.status, "pass");
});

test("text absent and vision absent both agree -> fail", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({ human_personal_brand: { state: "absent", strength: "absent", evidence: [] } }),
    visualIdentity: visionResult("absent"),
  });
  assert.equal(result.personal_brand.status, "fail");
  assert.equal(result.outcome, "reject");
  assert.equal(result.rejection_reason, "personal_brand_gate_failed");
});

test("text absent and vision unknown (no images) still fails -- unknown does not contradict", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({ human_personal_brand: { state: "absent", strength: "absent", evidence: [] } }),
    visualIdentity: noVision,
  });
  assert.equal(result.personal_brand.status, "fail");
});

test("text absent but vision confidently present still passes -- disagreement never forces a reject", () => {
  // Matches the PDF's own "ambiguous accounts" guidance: a branded account
  // may still pass when a specific founder is clearly the face, which is
  // exactly what a confident vision read establishes when text could not.
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({ human_personal_brand: { state: "absent", strength: "absent", evidence: [] } }),
    visualIdentity: visionResult("present"),
  });
  assert.equal(result.personal_brand.status, "pass");
  assert.notEqual(result.outcome, "reject");
});

test("both text and vision unknown -> uncertain, not a fail", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({ human_personal_brand: { state: "unknown", strength: "absent", evidence: [] } }),
    visualIdentity: noVision,
  });
  assert.equal(result.personal_brand.status, "uncertain");
});

// ---------------------------------------------------------------------------
// Gate 3 — Coach or Consultant (+ agency-owner exception)
// ---------------------------------------------------------------------------

test("coach_or_consultant present passes Gate 3 directly", () => {
  const result = applyIcpGates({ snapshot: snapshot(), extraction: extraction(), visualIdentity: noVision });
  assert.equal(result.coach_or_consultant.status, "pass");
});

test("coach_or_consultant absent with no agency exception fails", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({ coach_or_consultant: { state: "absent", strength: "absent", evidence: [] } }),
    visualIdentity: noVision,
  });
  assert.equal(result.coach_or_consultant.status, "fail");
  assert.equal(result.outcome, "reject");
  assert.equal(result.rejection_reason, "coach_or_consultant_gate_failed");
});

test("coach_or_consultant absent but a verified independent information funnel is uncertain, not a fail", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({
      coach_or_consultant: { state: "absent", strength: "absent", evidence: [] },
      // The exception is scoped to agency owners — without agency evidence
      // it never applies, even with a verified independent funnel.
      business_models: [{ type: "agency_service", prominence: "primary", evidence: cite() }],
      agency_evidence_bundle: {
        service_delivery: cite(), team_performance: cite(), service_cta: cite(), reliability: "reliable",
      },
      independent_information_offer: {
        own_audience: "present",
        own_transformation: "present",
        own_cta_path: "present",
        information_delivery: "present",
        sufficient_prominence: "present",
        evidence: cite(),
      },
    }),
    visualIdentity: noVision,
  });
  assert.equal(result.coach_or_consultant.status, "uncertain");
  assert.notEqual(result.outcome, "reject");
});

test("an extraction that predates coach_or_consultant is uncertain, never a fail", () => {
  const stale = extraction();
  delete (stale as Partial<CommercialExtraction>).coach_or_consultant;
  const result = applyIcpGates({ snapshot: snapshot(), extraction: stale, visualIdentity: noVision });
  assert.equal(result.coach_or_consultant.status, "uncertain");
});

// ---------------------------------------------------------------------------
// Gate 4 — Relevant Offer
// ---------------------------------------------------------------------------

test("no offers at all fails Gate 4", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({ offers: [] }),
    visualIdentity: noVision,
  });
  assert.equal(result.relevant_offer.status, "fail");
  assert.equal(result.rejection_reason, "relevant_offer_gate_failed");
});

test("only disqualifying offer types fails Gate 4", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({
      offers: [{
        offer_id: "o1", name: "Growth service", type: "done_for_you_service", prominence: "primary",
        audience: "coaches", delivery: "we run your ads", visitor_receives: ["done_for_you_service"],
        customer_implementation_role: "team_implemented", price: null, cta: "book a call",
        is_paid: "paid", active_status: "active", evidence: cite(),
      }],
    }),
    visualIdentity: noVision,
  });
  assert.equal(result.relevant_offer.status, "fail");
});

test("a relevant offer that is not confirmed paid is uncertain -- the free-course-only case", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({
      offers: [{
        offer_id: "o1", name: "Free training", type: "information_product", prominence: "primary",
        audience: "coaches", delivery: "video series", visitor_receives: ["education"],
        customer_implementation_role: "self_implemented", price: null, cta: "watch now",
        is_paid: "unknown", active_status: "active", evidence: cite(),
      }],
    }),
    visualIdentity: noVision,
  });
  assert.equal(result.relevant_offer.status, "uncertain");
  assert.equal(result.outcome, "manual_review");
});

test("a confirmed-paid relevant offer with no funnel evidence is uncertain, not a pass", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({
      information_funnel: {
        state: "absent", strength: "absent", label: "none",
        visitor_receives: [], asset_or_offer: null, evidence: [],
      },
    }),
    visualIdentity: noVision,
  });
  assert.equal(result.relevant_offer.status, "uncertain");
});

test("a confirmed-paid relevant offer with funnel evidence passes Gate 4", () => {
  const result = applyIcpGates({ snapshot: snapshot(), extraction: extraction(), visualIdentity: noVision });
  assert.equal(result.relevant_offer.status, "pass");
});

test("an application funnel is strong evidence on its own, even with no confirmed price -- the high-ticket 'book a call' case", () => {
  const result = applyIcpGates({
    snapshot: snapshot({}, { external_destinations: [destination({ destination_type: "application" })] }),
    extraction: extraction({
      offers: [{
        offer_id: "o1", name: "Elite 1:1 Coaching", type: "coaching", prominence: "primary",
        audience: "consultants", delivery: "qualification call", visitor_receives: ["coaching"],
        customer_implementation_role: "implements_with_guidance", price: null, cta: "apply",
        is_paid: "unknown", active_status: "active", evidence: cite(),
      }],
    }),
    visualIdentity: noVision,
  });
  assert.equal(result.relevant_offer.status, "pass");
  assert.match(result.relevant_offer.reason, /application\/booking funnel/);
});

test("a booking CTA on the offer itself is strong evidence even without a classified destination", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({
      offers: [{
        offer_id: "o1", name: "Strategy Session", type: "coaching", prominence: "primary",
        audience: "consultants", delivery: "1:1 call", visitor_receives: ["coaching"],
        customer_implementation_role: "implements_with_guidance", price: null, cta: "Book a consultation",
        is_paid: "unknown", active_status: "active", evidence: cite(),
      }],
    }),
    visualIdentity: noVision,
  });
  assert.equal(result.relevant_offer.status, "pass");
});

test("no price and no application/booking evidence at all stays uncertain", () => {
  const result = applyIcpGates({
    snapshot: snapshot(),
    extraction: extraction({
      offers: [{
        offer_id: "o1", name: "Coaching", type: "coaching", prominence: "primary",
        audience: "consultants", delivery: "video series", visitor_receives: ["coaching"],
        customer_implementation_role: "self_implemented", price: null, cta: "learn more",
        is_paid: "unknown", active_status: "active", evidence: cite(),
      }],
    }),
    visualIdentity: noVision,
  });
  assert.equal(result.relevant_offer.status, "uncertain");
});

// ---------------------------------------------------------------------------
// Full integration
// ---------------------------------------------------------------------------

test("large creator with unclear monetization goes to manual review, not auto-qualification", () => {
  const result = applyIcpGates({
    snapshot: snapshot({ followers: 250000 }),
    extraction: extraction({
      // No price confirmation AND no application/booking CTA -- genuinely
      // plausible-but-unconfirmed monetization, not just an undisclosed
      // price behind a real application funnel (see the CTA test below).
      offers: extraction().offers.map((offer) => ({ ...offer, is_paid: "unknown", cta: "learn more" })),
    }),
    visualIdentity: noVision,
  });
  assert.equal(result.outcome, "manual_review");
});

test("a lead clearing every gate reaches score", () => {
  const result = applyIcpGates({ snapshot: snapshot(), extraction: extraction(), visualIdentity: noVision });
  assert.equal(result.outcome, "score");
  assert.equal(result.personal_brand.status, "pass");
  assert.equal(result.coach_or_consultant.status, "pass");
  assert.equal(result.relevant_offer.status, "pass");
});

test("the follower gate short-circuits before gates 2-4 are meaningfully evaluated", () => {
  const result = applyIcpGates({
    snapshot: snapshot({ followers: 100 }),
    extraction: extraction({ human_personal_brand: { state: "absent", strength: "absent", evidence: [] } }),
    visualIdentity: noVision,
  });
  assert.equal(result.rejection_reason, "follower_below_minimum");
  assert.equal(result.personal_brand.status, "uncertain");
  assert.match(result.personal_brand.reason, /not evaluated/);
});
