import test from "node:test";
import assert from "node:assert/strict";
import { decideCommercialQualification } from "./decide";
import { classifyTrack } from "./classify-track";
import { applyCoreGate, applyHardBusinessModelGate } from "./eligibility";
import { scoreCommercialFit } from "./score";
import { computePriority } from "./priority";
import { findMaterialDisagreements, challengerTrigger } from "./challenger";
import type {
  ChallengerResult,
  CommercialExtraction,
  EvidenceCitation,
  EvidenceSnapshot,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cite = (id = "profile", type: EvidenceCitation["source_type"] = "bio"): EvidenceCitation[] => [
  { source_type: type, source_id: id, url: null, field: "bio", phrase: "I help consultants get premium clients" },
];

function snapshot(overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    snapshot_id: "snap_1",
    lead_id: null,
    username: "example",
    captured_at: "2026-07-31T10:00:00Z",
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
      profile_captured_at: "2026-07-31T10:00:00Z",
      external_link_capture_status: "captured",
      recent_posts: [],
      recent_posts_capture_status: "captured",
      pinned_posts: [],
      pinned_posts_capture_status: "captured",
      story_highlight_titles: [],
      story_highlights_capture_status: "not_attempted",
      story_highlights_captured_at: null,
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
    versions: { acquisition_version: "acquisition-1.0.0", fixture_revision: "fixtures-2026-07-31" },
    ...overrides,
  };
}

function extraction(overrides: Partial<CommercialExtraction> = {}): CommercialExtraction {
  return {
    extraction_prompt_version: "personal-brand-evidence-v1",
    evidence_snapshot_id: "snap_1",
    human_personal_brand: { state: "present", strength: "strong", evidence: cite() },
    audience: { label: "explicit", value: "consultants", evidence: cite() },
    transformation: {
      state: "present",
      strength: "strong",
      label: "explicit_result",
      outcome: "get premium clients",
      evidence: cite(),
    },
    information_funnel: {
      state: "present",
      strength: "credible",
      label: "visible_offer",
      visitor_receives: ["coaching"],
      asset_or_offer: "1:1 coaching",
      evidence: cite(),
    },
    cta: {
      state: "present",
      strength: "strong",
      label: "direct_sales_action",
      action: "apply",
      token_or_asset: null,
      evidence: cite(),
    },
    proof: { state: "unknown", strength: "absent", label: "absent", claims: [], evidence: [] },
    authority: {
      state: "present",
      strength: "credible",
      label: "credible",
      types: ["specialization"],
      evidence: cite(),
    },
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
        price: null,
        cta: "apply",
        evidence: cite(),
      },
    ],
    proof_attribution: [],
    primary_visitor_outcome: "coaching",
    primary_cta: "apply",
    ultimate_cta: "apply for coaching",
    cta_chain_resolved: true,
    acquisition_sufficiency: "sufficient",
    agency_evidence_bundle: {
      service_delivery: [],
      team_performance: [],
      service_cta: [],
      reliability: "absent",
    },
    agency_service_evidence: [],
    exclusion_evidence: [],
    conflicts: [],
    data_quality: "complete",
    unknown_surfaces: [],
    ...overrides,
  };
}

const agreeingChallenger: ChallengerResult = {
  challenger_prompt_version: "personal-brand-challenger-v1",
  business_model_conclusion: "information_personal_brand",
  primary_cta: "apply",
  ultimate_cta: "apply for coaching",
  visitor_receives: ["coaching"],
  agency_evidence_bundle: { service_delivery: [], team_performance: [], service_cta: [], reliability: "absent" },
  core_gate_passes: true,
  distinct_information_funnel: true,
  cta_chain_resolved: true,
  acquisition_sufficiency: "sufficient",
  signal_states: {
    information_funnel: "present",
    proof: "unknown",
    authority: "present",
    transformation: "present",
    cta: "present",
  },
  evidence: cite(),
  reason: "clear coaching funnel",
};

const decide = (
  ex: CommercialExtraction,
  snap = snapshot(),
  challenger: ChallengerResult | null = agreeingChallenger,
  agrees: boolean | null = true,
) =>
  decideCommercialQualification({
    snapshot: snap,
    extraction: ex,
    challenger,
    challengerAgrees: agrees,
  });

// ---------------------------------------------------------------------------
// The clear ICP case
// ---------------------------------------------------------------------------

test("a clear personal-brand information seller auto-approves without review", () => {
  const decision = decide(extraction());
  assert.equal(decision.track, "information_personal_brand");
  assert.equal(decision.decision, "qualified");
  assert.equal(decision.mode, "auto_approved");
  assert.equal(decision.certainty, "high");
  assert.ok(decision.scores.commercial_fit >= 8);
});

test("reproduces the specification's worked score example", () => {
  // buyer 2 + transformation 2 + funnel 1.5 + conversion 2 + authority 0.75 = 8.25
  const result = scoreCommercialFit(extraction(), snapshot());
  assert.equal(result.scores.buyer_clarity, 2);
  assert.equal(result.scores.transformation_clarity, 2);
  assert.equal(result.scores.information_funnel_evidence, 1.5);
  assert.equal(result.scores.conversion_intent, 2);
  assert.equal(result.scores.proof_maturity, 0.75);
  assert.equal(result.scores.commercial_fit, 8.25);
});

test("missing proof alone does not block automatic qualification", () => {
  const decision = decide(
    extraction({
      proof: { state: "unknown", strength: "absent", label: "absent", claims: [], evidence: [] },
    }),
  );
  assert.equal(decision.mode, "auto_approved");
  assert.ok(decision.review_flags.includes("proof_unverified"));
});

// ---------------------------------------------------------------------------
// The hard agency gate
// ---------------------------------------------------------------------------

test("a reliable done-for-you agency is rejected even at a perfect score", () => {
  const agency = extraction({
    primary_visitor_outcome: "done_for_you_service",
    business_models: [{ type: "agency_service", prominence: "primary", evidence: cite() }],
    proof: {
      state: "present",
      strength: "strong",
      label: "strong",
      claims: [
        {
          proof_id: "p1",
          claim: "$1.5M generated",
          beneficiary: "agency_client",
          result_type: "revenue",
          value: 1500000,
          currency: "USD",
          attributed_offer_id: null,
          producing_model: "done_for_you_service",
          self_reported: true,
          evidence: cite(),
        },
      ],
      evidence: cite(),
    },
    offers: [
      {
        offer_id: "offer_dfy",
        name: "Full Stack Growth",
        type: "done_for_you_service",
        prominence: "primary",
        audience: "coaches",
        delivery: "team builds and manages the funnel",
        visitor_receives: ["done_for_you_service"],
        customer_implementation_role: "team_implemented",
        price: null,
        cta: "book audit call",
        evidence: cite(),
      },
    ],
    agency_evidence_bundle: {
      service_delivery: cite("destination_0", "external_page"),
      team_performance: cite("destination_0", "external_page"),
      service_cta: cite("destination_0", "external_page"),
      reliability: "reliable",
    },
  });

  const decision = decide(agency);
  assert.equal(decision.decision, "rejected");
  assert.equal(decision.hard_exclusion, true);
  assert.equal(decision.rejection_reason, "primary_offer_done_for_you_service");
  assert.equal(decision.automatic_approval_eligible, false);
  // The score is preserved for analysis even though it can never restore eligibility.
  assert.ok(decision.scores.commercial_fit > 8);
});

test("the isolated word agency never triggers the hard gate", () => {
  const result = applyHardBusinessModelGate(
    extraction({
      agency_evidence_bundle: {
        service_delivery: [],
        team_performance: [],
        service_cta: [],
        reliability: "absent",
      },
    }),
  );
  assert.equal(result.hard_exclusion, false);
});

test("an agency owner with a verified independent information funnel goes to review, not rejection", () => {
  const mixed = extraction({
    primary_visitor_outcome: "done_for_you_service",
    business_models: [
      { type: "agency_service", prominence: "primary", evidence: cite() },
      { type: "information_education", prominence: "secondary", evidence: cite() },
    ],
    offers: [
      {
        offer_id: "offer_dfy",
        name: "DFY Growth",
        type: "done_for_you_service",
        prominence: "primary",
        audience: "coaches",
        delivery: "our team runs it",
        visitor_receives: ["done_for_you_service"],
        customer_implementation_role: "team_implemented",
        price: null,
        cta: "book audit",
        evidence: cite(),
      },
      {
        offer_id: "offer_course",
        name: "Client Acquisition Academy",
        type: "information_product",
        prominence: "secondary",
        audience: "coaches",
        delivery: "self-paced curriculum",
        visitor_receives: ["education"],
        customer_implementation_role: "self_implemented",
        price: "$997",
        cta: "enroll now",
        evidence: cite(),
      },
    ],
    agency_evidence_bundle: {
      service_delivery: cite(),
      team_performance: cite(),
      service_cta: cite(),
      reliability: "reliable",
    },
  });

  const decision = decide(mixed);
  assert.equal(decision.hard_exclusion, false);
  assert.equal(decision.decision, "review");
  assert.ok(decision.decision_reasons.includes("agency_information_mixed"));
});

test("an educational video whose ultimate CTA sells service delivery is still agency", () => {
  const funnel = extraction({
    primary_visitor_outcome: "done_for_you_service",
    ultimate_cta: "book a call with our team",
    business_models: [{ type: "agency_service", prominence: "primary", evidence: cite() }],
    offers: [
      {
        offer_id: "offer_dfy",
        name: "Managed Growth",
        type: "done_for_you_service",
        prominence: "primary",
        audience: "coaches",
        delivery: "we install and manage",
        visitor_receives: ["done_for_you_service"],
        customer_implementation_role: "team_implemented",
        price: null,
        cta: "book a call with our team",
        evidence: cite(),
      },
    ],
    agency_evidence_bundle: {
      service_delivery: cite(),
      team_performance: cite(),
      service_cta: cite(),
      reliability: "reliable",
    },
  });
  assert.equal(decide(funnel).rejection_reason, "primary_offer_done_for_you_service");
});

test("both models primary makes the track uncertain, not information", () => {
  const track = classifyTrack(
    extraction({
      business_models: [
        { type: "agency_service", prominence: "primary", evidence: cite() },
        { type: "information_education", prominence: "primary", evidence: cite() },
      ],
    }),
  );
  assert.equal(track.track, "uncertain");
  assert.equal(track.mixed, true);
});

// ---------------------------------------------------------------------------
// Core gate
// ---------------------------------------------------------------------------

test("proof plus CTA is not enough without an information funnel", () => {
  const decision = decide(
    extraction({
      information_funnel: {
        state: "absent",
        strength: "absent",
        label: "none",
        visitor_receives: [],
        asset_or_offer: null,
        evidence: [],
      },
      primary_visitor_outcome: "entertainment",
    }),
  );
  assert.notEqual(decision.decision, "qualified");
  assert.equal(decision.automatic_approval_eligible, false);
});

test("an unknown core signal routes to review, never to rejection", () => {
  const decision = decide(
    extraction({
      cta: {
        state: "unknown",
        strength: "absent",
        label: "none",
        action: null,
        token_or_asset: null,
        evidence: [],
      },
    }),
  );
  assert.equal(decision.decision, "review");
  assert.ok(decision.decision_reasons.includes("core_signal_unknown"));
});

test("core gate requires at least one supporting signal", () => {
  const gate = applyCoreGate(
    extraction({
      transformation: {
        state: "absent",
        strength: "absent",
        label: "none",
        outcome: null,
        evidence: [],
      },
      proof: { state: "absent", strength: "absent", label: "absent", claims: [], evidence: [] },
      authority: { state: "absent", strength: "absent", label: "absent", types: [], evidence: [] },
    }),
  );
  assert.equal(gate.passes, false);
  assert.equal(gate.supporting_present.length, 0);
});

test("a company account without a human personal brand cannot qualify", () => {
  const decision = decide(
    extraction({
      human_personal_brand: { state: "absent", strength: "absent", evidence: [] },
    }),
  );
  assert.notEqual(decision.decision, "qualified");
});

// ---------------------------------------------------------------------------
// Activity must never gate eligibility
// ---------------------------------------------------------------------------

test("weak engagement and stale posting cannot reject a qualified lead", () => {
  const quiet = snapshot({
    activity: {
      data_quality: "complete",
      median_unpinned_reel_views: 90,
      reel_view_rate: 0.002,
      posts_last_30_days: 0,
      reels_last_30_days: 0,
      days_since_latest_post: 140,
      median_likes_per_follower: 0.0004,
    },
  });
  const decision = decide(extraction(), quiet);
  assert.equal(decision.decision, "qualified");
  assert.equal(decision.mode, "auto_approved");
  // It ranks lower, but it still qualifies.
  assert.ok((decision.priority?.value ?? 10) < 8);
});

test("missing activity metrics lower confidence in priority, not the score", () => {
  const unknownActivity = {
    data_quality: "partial" as const,
    median_unpinned_reel_views: null,
    reel_view_rate: null,
    posts_last_30_days: null,
    reels_last_30_days: null,
    days_since_latest_post: null,
    median_likes_per_follower: null,
  };
  const scores = scoreCommercialFit(extraction(), snapshot()).scores;
  const priority = computePriority(scores, unknownActivity);

  assert.equal(priority.data_completeness, "unknown");
  // Renormalized over known weights: an absent metric must not score as zero.
  assert.ok(priority.value > 5, `expected renormalized priority, got ${priority.value}`);
});

// ---------------------------------------------------------------------------
// Certainty and the challenger
// ---------------------------------------------------------------------------

test("partial acquisition blocks auto-approval but keeps the lead qualified", () => {
  const decision = decide(extraction(), snapshot({ acquisition_sufficiency: "partial" }));
  assert.equal(decision.decision, "qualified");
  assert.equal(decision.mode, "manual_review");
  assert.notEqual(decision.certainty, "high");
});

test("YouTube as primary CTA without an inspected description is not high certainty", () => {
  const snap = snapshot({
    instagram: { ...snapshot().instagram, external_link: "https://www.youtube.com/@example" },
    youtube_channels: [
      {
        channel_id: "UC1",
        url: "https://www.youtube.com/@example",
        name: "Example",
        handle: "example",
        description: "coaching",
        subscribers: 1000,
        video_count: 50,
        outbound_urls: [],
        recent_video_titles: [],
        capture_status: "captured",
        captured_at: "2026-07-31T10:00:00Z",
        error: null,
      },
    ],
    youtube_videos: [],
  });
  const decision = decide(extraction(), snap);
  assert.notEqual(decision.certainty, "high");
  assert.equal(decision.mode, "manual_review");
});

test("challenger disagreement blocks auto-approval", () => {
  const decision = decide(extraction(), snapshot(), agreeingChallenger, false);
  assert.equal(decision.certainty, "low");
  assert.equal(decision.automatic_approval_eligible, false);
});

test("a challenger finding done-for-you evidence is a material disagreement", () => {
  const hostile: ChallengerResult = {
    ...agreeingChallenger,
    business_model_conclusion: "agency_service",
    agency_evidence_bundle: {
      service_delivery: cite(),
      team_performance: cite(),
      service_cta: cite(),
      reliability: "reliable",
    },
  };
  const disagreements = findMaterialDisagreements(extraction(), hostile);
  assert.ok(disagreements.length >= 2);
});

test("a challenger differing only on proof strength is not a disagreement", () => {
  const softer: ChallengerResult = {
    ...agreeingChallenger,
    signal_states: { ...agreeingChallenger.signal_states, proof: "absent" },
  };
  assert.deepEqual(findMaterialDisagreements(extraction(), softer), []);
});

test("the challenger does not run for reliable exclusions or dead acquisitions", () => {
  assert.equal(
    challengerTrigger({
      proposedAutoApproval: false,
      trackMixed: false,
      conflicts: 0,
      hardExclusion: true,
      acquisitionFailed: false,
    }),
    "none",
  );
  assert.equal(
    challengerTrigger({
      proposedAutoApproval: true,
      trackMixed: false,
      conflicts: 0,
      hardExclusion: false,
      acquisitionFailed: true,
    }),
    "none",
  );
  assert.equal(
    challengerTrigger({
      proposedAutoApproval: true,
      trackMixed: false,
      conflicts: 0,
      hardExclusion: false,
      acquisitionFailed: false,
    }),
    "proposed_auto_approval",
  );
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("the same evidence produces the same decision", () => {
  const a = decide(extraction());
  const b = decide(extraction());
  assert.deepEqual(
    { ...a, decided_at: null },
    { ...b, decided_at: null },
  );
});

test("every decision carries a full version chain", () => {
  const decision = decide(extraction());
  for (const [key, value] of Object.entries(decision.versions)) {
    assert.ok(value && value.length > 0, `${key} is missing`);
  }
});

// ---------------------------------------------------------------------------
// C4 · rejection confidence — the review-queue deadlock
//
// Regression suite for 2026-08-03. decide() gated every auto-reject behind
// `certainty === "high"`, which is unreachable whenever the challenger has not
// run — and it runs on a minority of leads. Across 75 real leads NOT ONE
// reached `high`, so 60 leads scoring at or below rejected_max were routed to a
// human. The review queue was 64 leads of which 4 genuinely needed an opinion.
// ---------------------------------------------------------------------------

/** An off-ICP commerce profile: fully captured, unambiguous, clearly not the ICP. */
function commerceExtraction(): CommercialExtraction {
  return extraction({
    human_personal_brand: { state: "absent", strength: "absent", evidence: [] },
    information_funnel: {
      state: "absent", strength: "absent", label: "none",
      visitor_receives: [], asset_or_offer: null, evidence: [],
    },
    transformation: {
      state: "absent", strength: "absent", label: "none",
      outcome: null, evidence: [],
    },
    authority: { state: "absent", strength: "absent", label: "absent", types: [], evidence: [] },
    audience: { label: "none", value: null, evidence: [] },
    business_models: [{ type: "commerce", prominence: "primary", evidence: cite() }],
    primary_visitor_outcome: "commerce_product",
    offers: [],
  });
}

test("an off-ICP profile that was fully captured is auto-rejected without the challenger", () => {
  const decision = decideCommercialQualification({
    snapshot: snapshot(),
    extraction: commerceExtraction(),
    challenger: null,
    challengerAgrees: null, // the challenger never ran — the common case
  });
  assert.equal(
    decision.decision,
    "rejected",
    `got ${decision.decision}; track=${decision.track} fit=${decision.scores.commercial_fit} reasons=${JSON.stringify(decision.decision_reasons)}`,
  );
  assert.notEqual(decision.certainty, "high", "rejection must not depend on reaching high certainty");
});

test("an UNKNOWN core signal still blocks auto-rejection — unknown is not absent", () => {
  /*
   * The safety valve. `absent` means we looked and it was not there; `unknown`
   * means we never saw the surface. Rejecting on evidence we failed to collect
   * is how a real lead disappears silently.
   */
  const decision = decideCommercialQualification({
    snapshot: snapshot(),
    extraction: extraction({
      ...commerceExtraction(),
      human_personal_brand: { state: "unknown", strength: "absent", evidence: [] },
    }),
    challenger: null,
    challengerAgrees: null,
  });
  assert.equal(decision.decision, "review", "an unseen core signal goes to a human, never the bin");
});

test("a challenger that DISPUTES the extraction blocks auto-rejection", () => {
  // Acting on a reading the reviewing model rejected is unsafe in either
  // direction. Caught during the replay: one lead was being auto-rejected on an
  // extraction the challenger had explicitly disagreed with.
  const decision = decideCommercialQualification({
    snapshot: snapshot(),
    extraction: commerceExtraction(),
    challenger: null,
    challengerAgrees: false,
  });
  assert.equal(decision.decision, "review");
});

test("an undetermined business model is never auto-rejected", () => {
  const decision = decideCommercialQualification({
    snapshot: snapshot(),
    extraction: extraction({
      human_personal_brand: { state: "absent", strength: "absent", evidence: [] },
      business_models: [],
      primary_visitor_outcome: null,
      offers: [],
    }),
    challenger: null,
    challengerAgrees: null,
  });
  assert.equal(decision.decision, "review", "\"we could not tell what this is\" is a question, not a rejection");
});

test("a profile that was never captured is a data retry, not a rejection", () => {
  const decision = decideCommercialQualification({
    snapshot: snapshot({
      instagram: { ...snapshot().instagram, profile_capture_status: "failed" },
    }),
    extraction: commerceExtraction(),
    challenger: null,
    challengerAgrees: null,
  });
  assert.equal(decision.decision, "data_retry");
});

test("a challenger that agrees clears the conflicts that summoned it", () => {
  /*
   * `conflicts > 0` is exactly what triggers the challenger (challenger.ts:150)
   * and it also forced certainty to `low`, so a challenged lead was condemned
   * before its verdict was read — all 14 challenged leads in the 2026-08-03 run
   * came back `low`, including the 4 the challenger agreed with.
   */
  const conflicted = extraction({ conflicts: ["unclear whether the offer is 1:1 or a course"] });
  const disputed = decideCommercialQualification({
    snapshot: snapshot(), extraction: conflicted, challenger: null, challengerAgrees: false,
  });
  const resolved = decideCommercialQualification({
    snapshot: snapshot(), extraction: conflicted, challenger: null, challengerAgrees: true,
  });
  assert.equal(disputed.certainty, "low", "an unresolved dispute stays low");
  assert.notEqual(resolved.certainty, "low", "agreement must be able to lift a lead out of low");
});

test("auto-approval still requires high certainty — the strict path is unchanged", () => {
  // Risk is asymmetric: a wrong approval puts a bad lead into outreach.
  const decision = decideCommercialQualification({
    snapshot: snapshot(),
    extraction: extraction({ conflicts: ["genuinely ambiguous offer"] }),
    challenger: null,
    challengerAgrees: false,
  });
  assert.equal(decision.certainty, "low");
  assert.equal(decision.automatic_approval_eligible, false);
});
