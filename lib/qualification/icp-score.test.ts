import test from "node:test";
import assert from "node:assert/strict";
import { scoreIcpFit } from "./icp-score";
import type { CommercialExtraction, EvidenceSnapshot, FunnelMaturitySignal } from "./types";

const cite = () => [
  { source_type: "bio" as const, source_id: "profile", url: null, field: "bio", phrase: "I help consultants get premium clients" },
];

function snapshot(overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
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
    ...overrides,
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

const fourSignals: FunnelMaturitySignal[] = [
  { kind: "name_field_positioning", present: true, evidence: cite() },
  { kind: "bio_promise", present: true, evidence: cite() },
  { kind: "application_funnel", present: true, evidence: cite() },
  { kind: "offer_highlight", present: true, evidence: cite() },
];

test("a maxed-out lead scores 12/12", () => {
  const result = scoreIcpFit(extraction(), snapshot({ funnel_maturity_signals: fourSignals }));
  assert.equal(result.scores.audience_specificity, 2);
  assert.equal(result.scores.transformation_clarity, 2);
  assert.equal(result.scores.offer_clarity, 2);
  assert.equal(result.scores.conversion_path, 2);
  assert.equal(result.scores.proof, 2);
  assert.equal(result.scores.funnel_maturity, 2);
  assert.equal(result.scores.total_icp_score, 12);
});

test("a bare-minimum lead scores 0/12", () => {
  const result = scoreIcpFit(
    extraction({
      audience: { label: "none", value: null, evidence: [] },
      transformation: { state: "absent", strength: "absent", label: "none", outcome: null, evidence: [] },
      cta: { state: "absent", strength: "absent", label: "none", action: null, token_or_asset: null, evidence: [] },
      proof: { state: "absent", strength: "absent", label: "absent", claims: [], evidence: [] },
      offers: [],
    }),
    snapshot(),
  );
  assert.equal(result.scores.total_icp_score, 0);
});

test("audience specificity: broad and inferred both map to 1, specific and explicit to 2", () => {
  const at = (label: CommercialExtraction["audience"]["label"]) =>
    scoreIcpFit(extraction({ audience: { label, value: "someone", evidence: cite() } }), snapshot()).scores
      .audience_specificity;
  assert.equal(at("none"), 0);
  assert.equal(at("broad"), 1);
  assert.equal(at("inferred"), 1);
  assert.equal(at("specific"), 2);
  assert.equal(at("explicit"), 2);
});

test("a direct-response CTA (DM/comment keyword) boosts conversion path to 2 even off a weak label", () => {
  const withoutBoost = scoreIcpFit(
    extraction({
      cta: { state: "present", strength: "weak", label: "audience_only", action: null, token_or_asset: null, evidence: cite() },
    }),
    snapshot(),
  );
  assert.equal(withoutBoost.scores.conversion_path, 1);

  const withBoost = scoreIcpFit(
    extraction({
      cta: { state: "present", strength: "weak", label: "audience_only", action: null, token_or_asset: null, evidence: cite() },
    }),
    snapshot({ direct_response_ctas: [{ action: "dm", keyword: "COACH", source: "bio:profile", phrase: "DM COACH" }] }),
  );
  assert.equal(withBoost.scores.conversion_path, 2);
  assert.match(withBoost.components.conversion_path.reason, /boosted to 2/);
});

test("offer clarity requires type, audience, and result/delivery together for 2 points", () => {
  const clear = scoreIcpFit(extraction(), snapshot()).scores.offer_clarity;
  assert.equal(clear, 2);

  const partial = scoreIcpFit(
    extraction({
      offers: [{
        offer_id: "o1", name: "Coaching", type: "coaching", prominence: "primary",
        audience: null, delivery: null, visitor_receives: ["coaching"],
        customer_implementation_role: "unknown", price: null, cta: null,
        is_paid: "unknown", active_status: "unknown", evidence: cite(),
      }],
    }),
    snapshot(),
  ).scores.offer_clarity;
  assert.equal(partial, 1);

  const none = scoreIcpFit(extraction({ offers: [] }), snapshot()).scores.offer_clarity;
  assert.equal(none, 0);
});

test("funnel maturity: 0 signals -> 0, 1-3 -> 1, 4+ -> 2", () => {
  const at = (signals: FunnelMaturitySignal[]) =>
    scoreIcpFit(extraction(), snapshot({ funnel_maturity_signals: signals })).scores.funnel_maturity;

  assert.equal(at([]), 0);
  assert.equal(at([{ kind: "bio_promise", present: false, evidence: [] }]), 0);
  assert.equal(at(fourSignals.slice(0, 1)), 1);
  assert.equal(at(fourSignals.slice(0, 3)), 1);
  assert.equal(at(fourSignals), 2);
});

test("a snapshot that predates funnel_maturity_signals scores 0, not an error", () => {
  const snap = snapshot();
  delete (snap as Partial<EvidenceSnapshot>).funnel_maturity_signals;
  const result = scoreIcpFit(extraction(), snap);
  assert.equal(result.scores.funnel_maturity, 0);
});

test("an unmapped label surfaces as an explicit mismatch rather than a silent zero-with-no-explanation", () => {
  // Simulates a scorecard/extractor version mismatch at runtime — TypeScript
  // would reject this literal in real code, which is exactly why the check
  // has to be a runtime one.
  const result = scoreIcpFit(
    extraction({
      audience: {
        label: "made_up_label" as CommercialExtraction["audience"]["label"],
        value: "x",
        evidence: cite(),
      },
    }),
    snapshot(),
  );
  assert.equal(result.scores.audience_specificity, 0);
  assert.match(result.components.audience_specificity.reason, /unmapped label/);
});

test("proof label ladder: absent 0, weak 1, credible and strong both 2", () => {
  const at = (label: CommercialExtraction["proof"]["label"]) =>
    scoreIcpFit(extraction({ proof: { state: "present", strength: "strong", label, claims: [], evidence: cite() } }), snapshot())
      .scores.proof;
  assert.equal(at("absent"), 0);
  assert.equal(at("weak"), 1);
  assert.equal(at("credible"), 2);
  assert.equal(at("strong"), 2);
});
