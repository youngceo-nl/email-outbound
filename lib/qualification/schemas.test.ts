import test from "node:test";
import assert from "node:assert/strict";
import {
  commercialExtractionSchema,
  ctaChainSchema,
  proofEvidenceSchema,
  qualificationVersionsSchema,
  validateCitationsResolve,
} from "./schemas";
import type { CommercialExtraction } from "./types";

const bioCitation = {
  source_type: "bio" as const,
  source_id: "profile",
  url: null,
  field: "bio",
  phrase: "I help Christian men get jacked",
};

function baseExtraction(): Record<string, unknown> {
  return {
    extraction_prompt_version: "personal-brand-evidence-v1",
    evidence_snapshot_id: "snap_1",
    human_personal_brand: { state: "present", strength: "strong", evidence: [bioCitation] },
    audience: { label: "explicit", value: "Christian men", evidence: [bioCitation] },
    transformation: {
      state: "present",
      strength: "strong",
      label: "explicit_result",
      outcome: "get jacked",
      evidence: [bioCitation],
    },
    information_funnel: {
      state: "present",
      strength: "credible",
      label: "visible_offer",
      visitor_receives: ["coaching"],
      asset_or_offer: "1:1 coaching",
      evidence: [bioCitation],
    },
    cta: {
      state: "present",
      strength: "strong",
      label: "direct_sales_action",
      action: "dm_keyword",
      token_or_asset: "READY",
      evidence: [bioCitation],
    },
    proof: { state: "unknown", strength: "absent", label: "absent", claims: [], evidence: [] },
    authority: {
      state: "present",
      strength: "credible",
      label: "credible",
      types: ["specialization"],
      evidence: [bioCitation],
    },
    business_models: [
      { type: "information_education", prominence: "primary", evidence: [bioCitation] },
    ],
    offers: [],
    proof_attribution: [],
    primary_visitor_outcome: "coaching",
    primary_cta: "DM READY",
    ultimate_cta: "apply for 1:1 coaching",
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
  };
}

test("accepts a well-formed extraction", () => {
  const parsed = commercialExtractionSchema.safeParse(baseExtraction());
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test("rejects an affirmative signal with no citation", () => {
  const input = baseExtraction();
  (input.information_funnel as Record<string, unknown>).evidence = [];
  const parsed = commercialExtractionSchema.safeParse(input);
  assert.equal(parsed.success, false);
  assert.match(JSON.stringify(parsed.error?.issues), /information_funnel.*no evidence was cited/);
});

test("rejects a non-absent strength with no citation", () => {
  const input = baseExtraction();
  input.proof = { state: "unknown", strength: "credible", label: "credible", claims: [], evidence: [] };
  const parsed = commercialExtractionSchema.safeParse(input);
  assert.equal(parsed.success, false);
});

test("rejects an absent state carrying positive strength", () => {
  const input = baseExtraction();
  input.proof = {
    state: "absent",
    strength: "strong",
    label: "strong",
    claims: [],
    evidence: [bioCitation],
  };
  const parsed = commercialExtractionSchema.safeParse(input);
  assert.equal(parsed.success, false);
  assert.match(JSON.stringify(parsed.error?.issues), /cannot be absent with strength/);
});

test("allows unknown state with no citation — unknown is not absence", () => {
  const input = baseExtraction();
  input.proof = { state: "unknown", strength: "absent", label: "absent", claims: [], evidence: [] };
  assert.equal(commercialExtractionSchema.safeParse(input).success, true);
});

test("rejects unknown enum members", () => {
  const input = baseExtraction();
  (input.information_funnel as Record<string, unknown>).label = "super_offer";
  assert.equal(commercialExtractionSchema.safeParse(input).success, false);
});

test("rejects fields outside the schema", () => {
  const input = baseExtraction();
  input.overall_score = 9.2;
  const parsed = commercialExtractionSchema.safeParse(input);
  assert.equal(parsed.success, false);
});

test("rejects a reliable agency bundle with no component evidence", () => {
  const input = baseExtraction();
  input.agency_evidence_bundle = {
    service_delivery: [],
    team_performance: [],
    service_cta: [],
    reliability: "reliable",
  };
  const parsed = commercialExtractionSchema.safeParse(input);
  assert.equal(parsed.success, false);
  assert.match(JSON.stringify(parsed.error?.issues), /reliable but no component evidence/);
});

test("requires an explicit proof beneficiary", () => {
  const withoutBeneficiary = {
    proof_id: "p1",
    claim: "$1.5M generated",
    result_type: "revenue",
    value: 1500000,
    currency: "USD",
    self_reported: true,
    evidence: [bioCitation],
  };
  assert.equal(proofEvidenceSchema.safeParse(withoutBeneficiary).success, false);

  assert.equal(
    proofEvidenceSchema.safeParse({ ...withoutBeneficiary, beneficiary: "unknown" }).success,
    true,
  );
});

test("rejects out-of-order CTA hops", () => {
  const hops = [
    { hop: 0, source_type: "instagram_profile", source_id: "profile", action: "visit_link", destination_url: "https://x.co", visitor_receives: null, evidence: "link in bio" },
    { hop: 2, source_type: "external_page", source_id: "destination_1", action: "book_call", destination_url: null, visitor_receives: "coaching", evidence: "Book a call" },
  ];
  assert.equal(ctaChainSchema.safeParse(hops).success, false);

  hops[1].hop = 1;
  assert.equal(ctaChainSchema.safeParse(hops).success, true);
});

test("rejects a version record missing an ID", () => {
  const versions = {
    acquisition_version: "acq-1.0.0",
    extraction_prompt_version: "personal-brand-evidence-v1",
    challenger_prompt_version: "challenger-v1",
    scorecard_version: "personal-brand-score-v1",
    config_version: "config-v1",
  };
  assert.equal(qualificationVersionsSchema.safeParse(versions).success, false);
  assert.equal(
    qualificationVersionsSchema.safeParse({ ...versions, pipeline_version: "p-1" }).success,
    true,
  );
});

test("flags citations that do not resolve against the snapshot", () => {
  const extraction = commercialExtractionSchema.parse(baseExtraction()) as CommercialExtraction;
  const known = new Set(["bio:profile"]);
  assert.deepEqual(validateCitationsResolve(extraction, known), []);

  const invented = commercialExtractionSchema.parse({
    ...baseExtraction(),
    cta: {
      state: "present",
      strength: "strong",
      label: "direct_sales_action",
      action: "book",
      token_or_asset: null,
      evidence: [
        {
          source_type: "external_page",
          source_id: "destination_9",
          url: "https://example.com",
          field: "cta_labels",
          phrase: "Book a call",
        },
      ],
    },
  }) as CommercialExtraction;
  const problems = validateCitationsResolve(invented, known);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /external_page:destination_9/);
});
