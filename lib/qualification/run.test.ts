import test from "node:test";
import assert from "node:assert/strict";
import { runCommercialQualification } from "./run";
import { normalizeInstagramEvidence, type RawInstagramUser } from "@/lib/evidence/instagram";
import type { PageFetcher } from "@/lib/evidence/external";
import type { PageFetchOutcome } from "@/lib/evidence/http";
import type { LlmClient } from "./providers";

const COACHING_PAGE = `<!doctype html><html><head>
  <title>The Client Acceleration Program</title>
  <meta name="description" content="Private coaching for consultants who want premium clients." />
</head><body>
  <h1>The Client Acceleration Program</h1>
  <p>A 12-week 1:1 coaching program where I teach you the system I used to sign 139 clients.</p>
  <a href="https://example.com/apply">Apply For Coaching</a>
</body></html>`;

function fetcher(pages: Record<string, string>): PageFetcher {
  return async (url: string): Promise<PageFetchOutcome> => {
    const html = pages[url];
    if (!html) return { ok: false, failure: { kind: "http_error", detail: "HTTP 404" } };
    return { ok: true, page: { html, finalUrl: url, redirectChain: [url], method: "free_fetch" } };
  };
}

function igEvidence(overrides: Partial<RawInstagramUser> = {}) {
  return normalizeInstagramEvidence({
    username: "examplecoach",
    user: {
      username: "examplecoach",
      full_name: "Example | Business Coach",
      biography: "I help consultants get premium clients. Apply below.",
      external_url: "https://example.com/coaching",
      is_private: false,
      edge_followed_by: { count: 20000 },
      edge_follow: { count: 400 },
      edge_owner_to_timeline_media: {
        count: 200,
        edges: [
          {
            node: {
              shortcode: "p1",
              is_video: true,
              video_view_count: 4000,
              edge_media_to_caption: { edges: [{ node: { text: "How I sign consultants" } }] },
              taken_at_timestamp: Math.floor(Date.now() / 1000) - 86400,
              pinned_for_users: [],
            },
          },
        ],
      },
      ...overrides,
    },
  });
}

/** Returns a valid extraction, then a valid challenger agreement. */
function scriptedLlm(overrides: Record<string, unknown> = {}): LlmClient & { calls: string[] } {
  const calls: string[] = [];
  const client = (async (request) => {
    const isChallenger = request.system.includes("adversarial evidence verifier");
    const isCommerce = request.user.includes("EXTRACTION PASS: COMMERCE");
    calls.push(isChallenger ? "challenger" : isCommerce ? "commerce" : "signals");

    const cite = [
      { source_type: "bio", source_id: "profile", url: "", field: "bio", phrase: "I help consultants get premium clients" },
    ];

    const body = isChallenger
      ? {
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
          evidence: cite,
          reason: "clear coaching funnel",
        }
      : isCommerce
        ? {
            citations: cite,
            offer_inventory: [
              {
                offer_id: "offer_1",
                name: "1:1 coaching",
                type: "coaching",
                prominence: "primary",
                audience: "consultants",
                delivery: "private coaching",
                customer_implementation_role: "implements_with_guidance",
                price: "",
                cta: "apply for coaching",
                evidence_ids: [0],
              },
            ],
            proof_inventory: [],
            primary_offer: { offer_id: "offer_1", rationale: "only offer, primary bio CTA" },
            primary_offer_delivery: "information",
            done_for_you_service_evidence: {
              service_delivery_ids: [],
              team_performance_ids: [],
              service_cta_ids: [],
              reliability: "absent",
            },
            independent_information_offer_evidence: {
              own_audience: "unknown",
              own_transformation: "unknown",
              own_cta_path: "unknown",
              information_delivery: "unknown",
              sufficient_prominence: "unknown",
              evidence_ids: [],
            },
            conflicts: [],
            unknowns: [],
            acquisition_observations: {
              cta_chain_resolved: true,
              acquisition_sufficiency: "sufficient",
              data_quality: "complete",
              unknown_surfaces: [],
            },
            ...overrides,
          }
        : {
            citations: cite,
            personal_brand: { state: "present", strength: "strong", evidence_ids: [0] },
            audience: { label: "explicit", value: "consultants", evidence_ids: [0] },
            transformation: { state: "present", strength: "strong", label: "explicit_result", outcome: "premium clients", evidence_ids: [0] },
            information_funnel: { state: "present", strength: "credible", label: "visible_offer", asset_or_offer: "1:1 coaching", evidence_ids: [0] },
            conversion_cta: { state: "present", strength: "strong", label: "direct_sales_action", action: "apply", token_or_asset: "", evidence_ids: [0] },
            primary_visitor_outcome: "coaching",
            proof: { state: "unknown", strength: "absent", evidence_ids: [] },
            authority: { state: "present", strength: "credible", types: ["specialization"], evidence_ids: [0] },
            named_mechanisms: [],
            ...overrides,
          };

    return {
      text: JSON.stringify(body),
      provider: "openai" as const,
      model: "test-model",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }) as LlmClient & { calls: string[] };
  client.calls = calls;
  return client;
}

const deps = (llm: LlmClient, pages: Record<string, string>) => ({
  fetchPage: fetcher(pages),
  collectYouTube: async () => ({ channels: [], videos: [], outbound_urls: [] }),
  llm,
});

test("runs acquisition, extraction, challenger, and decision in order", async () => {
  const llm = scriptedLlm();
  const result = await runCommercialQualification({
    instagram: igEvidence(),
    llm,
    dependencies: deps(llm, { "https://example.com/coaching": COACHING_PAGE }),
  });

  assert.equal(result.sufficiency.verdict, "sufficient");
  assert.ok(result.snapshot);
  assert.equal(result.extraction?.ok, true);
  assert.deepEqual(llm.calls, ["signals", "commerce", "challenger"]);
  assert.equal(result.challenger_trigger, "proposed_auto_approval");
  assert.equal(result.decision.decision, "qualified");
  assert.equal(result.decision.mode, "auto_approved");

  // The snapshot id is asserted by us, never chosen by the model.
  assert.equal(
    result.extraction?.ok ? result.extraction.extraction.evidence_snapshot_id : null,
    result.snapshot?.snapshot_id,
  );
});

test("a universal exclusion short-circuits before any model call", async () => {
  const llm = scriptedLlm();
  const result = await runCommercialQualification({
    instagram: igEvidence({ full_name: "Daily Meme Page" }),
    llm,
    dependencies: deps(llm, {}),
  });

  assert.equal(result.decision.decision, "rejected");
  assert.equal(result.snapshot, null);
  assert.deepEqual(llm.calls, [], "no tokens should be spent on a reliable exclusion");
});

test("a failed profile capture becomes a data retry, never a rejection", async () => {
  const llm = scriptedLlm();
  const result = await runCommercialQualification({
    instagram: normalizeInstagramEvidence({ username: "gone", user: null, providerError: "SB 500" }),
    llm,
    dependencies: deps(llm, {}),
  });

  assert.equal(result.decision.decision, "data_retry");
  assert.equal(result.decision.mode, "retry_required");
  assert.deepEqual(llm.calls, []);
});

test("invalid model output routes to review rather than rejecting the lead", async () => {
  const broken = (async () => ({
    text: "{ not json at all",
    provider: "openai" as const,
    model: "test-model",
    usage: { inputTokens: 10, outputTokens: 5 },
  })) as LlmClient;

  const result = await runCommercialQualification({
    instagram: igEvidence(),
    llm: broken,
    dependencies: deps(broken, { "https://example.com/coaching": COACHING_PAGE }),
  });

  assert.equal(result.decision.decision, "review");
  assert.ok(result.decision.decision_reasons.includes("ai_output_invalid"));
  assert.equal(result.extraction?.ok, false);
});

test("an extraction citing a nonexistent source is rejected as invalid", async () => {
  const inventing = scriptedLlm({
    citations: [
      { source_type: "external_page", source_id: "destination_42", url: "", field: "cta", phrase: "Apply" },
    ],
  });

  const result = await runCommercialQualification({
    instagram: igEvidence(),
    llm: inventing,
    dependencies: deps(inventing, { "https://example.com/coaching": COACHING_PAGE }),
  });

  assert.equal(result.extraction?.ok, false);
  assert.equal(result.decision.decision, "review");
});

test("reruns on the same evidence produce the same decision", async () => {
  const pages = { "https://example.com/coaching": COACHING_PAGE };
  const runOnce = async () => {
    const llm = scriptedLlm();
    const result = await runCommercialQualification({
      instagram: igEvidence(),
      llm,
      dependencies: deps(llm, pages),
    });
    return {
      decision: result.decision.decision,
      mode: result.decision.mode,
      track: result.decision.track,
      scores: result.decision.scores,
      certainty: result.decision.certainty,
    };
  };
  assert.deepEqual(await runOnce(), await runOnce());
});
