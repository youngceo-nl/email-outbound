import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractionResult } from "./extract";
import {
  computeSlots,
  deriveStages,
  findJam,
  runHealth,
  type RunLeadRecord,
  deriveRunTotals,
  type RunTotalsLead,
  type SlotLeadRecord,
} from "./pipeline-stages";
import type { CommercialDecision, EvidenceSnapshot } from "./types";

function runLead(overrides: Partial<RunLeadRecord> = {}): RunLeadRecord {
  return {
    status: "ok",
    error_message: null,
    acquisition_source: "apify",
    profile_extraction_method: "provider",
    sufficiency_verdict: "sufficient",
    sufficiency_data_quality: "complete",
    sufficiency_reasons: [],
    sufficiency_exclusion_evidence: null,
    extraction_ok: true,
    extraction_provider: "anthropic",
    extraction_model: "claude-haiku-4-5",
    extraction_input_tokens: 21000,
    extraction_output_tokens: 1200,
    extraction_failure_reason: null,
    extraction_problems: null,
    challenger_trigger: "none",
    challenger_ran: null,
    challenger_agrees: null,
    challenger_error: null,
    challenger_disagreements: null,
    challenger_model: null,
    challenger_input_tokens: null,
    challenger_output_tokens: null,
    acquisition_ms: 900,
    extraction_ms: 14000,
    challenger_ms: 0,
    total_ms: 15000,
    ...overrides,
  };
}

function stageBy(stages: ReturnType<typeof deriveStages>, key: string) {
  const stage = stages.find((s) => s.key === key);
  assert.ok(stage, `expected a stage keyed ${key}`);
  return stage;
}

test("a failed extraction explains the zero scores instead of implying a weak profile", () => {
  // The 2026-08-01 outage in miniature: the credit balance ran out, so the model
  // never ran, and every dimension was written as 0.
  const extraction: ExtractionResult = {
    ok: false,
    reason: "provider_error",
    problems: ['signals pass: 400 {"type":"error","error":{"message":"Your credit balance is too low"}}'],
    provider: "anthropic",
    model: "claude-haiku-4-5",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  const decision = {
    scores: {
      buyer_clarity: 0,
      transformation_clarity: 0,
      information_funnel_evidence: 0,
      conversion_intent: 0,
      proof_strength: 0,
      authority_strength: 0,
      proof_maturity: 0,
      commercial_fit: 0,
    },
    signal_states: {},
    track: "uncertain",
    icp_eligible: true,
    hard_exclusion: false,
    rejection_reason: null,
    certainty: "low",
    decision: "review",
    mode: "manual_review",
    automatic_approval_eligible: false,
    decision_reasons: ["ai_output_invalid"],
    review_flags: [],
  } as unknown as CommercialDecision;

  const stages = deriveStages({
    runLead: runLead({ extraction_ok: false, extraction_failure_reason: "provider_error", extraction_problems: extraction.problems }),
    snapshot: null,
    extraction,
    decision,
  });

  const extractionStage = stageBy(stages, "extraction");
  assert.equal(extractionStage.state, "failed");
  // The operator must be able to read the provider error verbatim.
  assert.ok(
    extractionStage.rows.some((r) => r.value.includes("credit balance is too low")),
    "the raw provider error must survive to the UI",
  );

  const coreGate = stageBy(stages, "core-gate");
  assert.equal(coreGate.state, "failed");
  assert.match(coreGate.headline, /because extraction failed/);
});

test("a universal exclusion is blocked, not failed, and halts later stages", () => {
  const stages = deriveStages({
    runLead: runLead({
      sufficiency_verdict: "excluded",
      sufficiency_exclusion_evidence: "bio: 'meme page'",
      extraction_ok: null,
      extraction_provider: null,
      extraction_model: null,
      extraction_input_tokens: null,
      extraction_output_tokens: null,
      challenger_trigger: null,
    }),
    snapshot: null,
    extraction: null,
    decision: null,
  });

  const sufficiency = stageBy(stages, "sufficiency");
  assert.equal(sufficiency.state, "blocked");
  assert.ok(sufficiency.rows.some((r) => r.value.includes("meme page")));

  // A correct reject must never be rendered as a system defect.
  assert.equal(stages.some((s) => s.state === "failed"), false);
  assert.equal(stageBy(stages, "extraction").state, "skipped");
  assert.equal(stageBy(stages, "challenger").state, "skipped");
});

test("an acquisition throw is visible even though nothing else was persisted", () => {
  const stages = deriveStages({
    runLead: runLead({
      status: "acquisition_failed",
      error_message: "apify profile actor run failed",
      sufficiency_verdict: null,
      extraction_ok: null,
      challenger_trigger: null,
    }),
    snapshot: null,
    extraction: null,
    decision: null,
  });

  const acquisition = stageBy(stages, "acquisition");
  assert.equal(acquisition.state, "failed");
  assert.ok(acquisition.rows.some((r) => r.value.includes("apify profile actor run failed")));
});

test("a pre-migration row reports not-recorded rather than a false green", () => {
  const stages = deriveStages({
    runLead: runLead({
      sufficiency_verdict: null,
      challenger_trigger: null,
      extraction_ok: null,
      acquisition_ms: null,
      extraction_ms: null,
      challenger_ms: null,
      total_ms: null,
    }),
    snapshot: null,
    extraction: null,
    decision: null,
  });

  assert.equal(stageBy(stages, "sufficiency").recorded, false);
  assert.equal(stageBy(stages, "challenger").recorded, false);
  assert.equal(stages.some((s) => s.state === "ok"), false);
});

test("a skipped challenger says why it did not fire", () => {
  const decision = { hard_exclusion: true } as unknown as CommercialDecision;
  const stages = deriveStages({
    runLead: runLead({ challenger_trigger: "none" }),
    snapshot: null,
    extraction: null,
    decision,
  });
  const challenger = stageBy(stages, "challenger");
  assert.equal(challenger.state, "skipped");
  assert.match(challenger.headline, /hard-excluded/);
});

test("a disagreeing challenger is degraded and lists what it disputed", () => {
  const stages = deriveStages({
    runLead: runLead({
      challenger_trigger: "conflicting_evidence",
      challenger_ran: true,
      challenger_agrees: false,
      challenger_disagreements: ["challenger found done_for_you primary"],
      challenger_model: "claude-opus-5",
      challenger_input_tokens: 27000,
      challenger_output_tokens: 1000,
    }),
    snapshot: null,
    extraction: null,
    decision: null,
  });
  const challenger = stageBy(stages, "challenger");
  assert.equal(challenger.state, "degraded");
  assert.ok(challenger.rows.some((r) => r.value.includes("done_for_you primary")));
  // Opus token spend must be attributable per lead.
  assert.ok(challenger.rows.some((r) => r.value.includes("27000")));
});

test("metadata fallback degrades acquisition and names the reason", () => {
  const snapshot = {
    instagram: {
      profile_capture_status: "captured",
      profile_extraction_method: "metadata_fallback",
      acquisition_source: "apify",
      recent_posts_capture_status: "captured",
      pinned_posts_capture_status: "captured",
      story_highlights_capture_status: "captured",
      external_link_capture_status: "unavailable",
      followers: 1000,
      is_private: false,
    },
  } as unknown as EvidenceSnapshot;

  const stages = deriveStages({
    runLead: runLead({ acquisition_source: "apify" }),
    snapshot,
    extraction: null,
    decision: null,
  });
  const acquisition = stageBy(stages, "acquisition");
  assert.equal(acquisition.state, "degraded");
  assert.match(acquisition.headline, /metadata fallback/);
  assert.ok(acquisition.rows.some((r) => r.value === "Apify"));
});

test("queued leads that never started count as stuck, not passed", () => {
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const fresh = new Date().toISOString();
  const leads = [
    // One genuinely working through acquisition.
    { stage: "acquiring", status: "running", stage_entered_at: fresh, extraction_ok: null, decision: null, mode: null },
    // Nine enqueued half an hour ago and never picked up — the invisible case.
    ...Array.from({ length: 9 }, () => ({
      stage: "queued",
      status: "queued",
      stage_entered_at: stale,
      extraction_ok: null,
      decision: null,
      mode: null,
    })),
  ];

  const slots = computeSlots(leads);
  const queued = slots.find((s) => s.key === "queued")!;
  assert.equal(queued.active, 9);
  assert.equal(queued.stuck, 9, "stale queued leads must read as stuck");
  assert.equal(queued.failed, 0, "stuck is not the same as failed");

  const jam = findJam(slots);
  assert.equal(jam?.slot.key, "queued");
});

test("a failed extraction lands in the extraction slot as failed", () => {
  const slots = computeSlots([
    {
      stage: "extracting",
      status: "ok",
      stage_entered_at: new Date().toISOString(),
      extraction_ok: false,
      decision: "review",
      mode: "manual_review",
    },
  ]);
  const extracting = slots.find((s) => s.key === "extracting")!;
  assert.equal(extracting.failed, 1);
  assert.equal(extracting.active, 0);
});

test("entered counts accumulate downstream so drops are visible", () => {
  const now = new Date().toISOString();
  const slots = computeSlots([
    { stage: "done", status: "ok", stage_entered_at: now, extraction_ok: true, decision: "qualified", mode: "auto_approved" },
    { stage: "acquiring", status: "running", stage_entered_at: now, extraction_ok: null, decision: null, mode: null },
  ]);
  // Both leads passed through acquisition; only one reached the end.
  assert.equal(slots.find((s) => s.key === "acquiring")!.entered, 2);
  assert.equal(slots.find((s) => s.key === "done")!.entered, 1);
});

test("leads with no stage are ignored rather than counted as slot zero", () => {
  const slots = computeSlots([
    { stage: null, status: "ok", stage_entered_at: null, extraction_ok: true, decision: "qualified", mode: "auto_approved" },
  ]);
  assert.equal(slots.every((s) => s.entered === 0 && s.active === 0), true);
});

test("runHealth flags a mostly-failed batch as broken", () => {
  // Yesterday's shape: 594 processed, 552 extraction failures.
  const broken = runHealth({
    processed_count: 594,
    acquisition_failed_count: 0,
    extraction_failed_count: 552,
    persist_failed_count: 3,
  });
  assert.equal(broken.health, "broken");
  assert.equal(broken.failures, 555);

  const healthy = runHealth({
    processed_count: 100,
    acquisition_failed_count: 1,
    extraction_failed_count: 0,
    persist_failed_count: 0,
  });
  assert.equal(healthy.health, "healthy");
});

test("run totals come from the lead rows, not the stale run counters", () => {
  const lead = (over: Partial<RunTotalsLead>): RunTotalsLead => ({
    stage: "done", status: "ok", decision: "review", extraction_ok: true, challenger_ran: false,
    extraction_model: "claude-haiku-4-5", challenger_model: null,
    extraction_input_tokens: 1000, extraction_output_tokens: 100,
    challenger_input_tokens: 0, challenger_output_tokens: 0, total_ms: 30000, ...over,
  });
  const totals = deriveRunTotals([
    lead({ decision: "qualified" }),
    lead({ decision: "review", challenger_ran: true, challenger_model: "claude-opus-5",
           challenger_input_tokens: 8000, challenger_output_tokens: 2000 }),
    lead({ decision: null, status: "acquisition_failed", stage: "acquiring" }),
    lead({ decision: null, status: "queued", stage: "queued", extraction_input_tokens: 0,
           extraction_output_tokens: 0, extraction_ok: null, total_ms: null }),
  ], 4);

  assert.equal(totals.processed, 3, "two decided + one failed; the queued lead is not processed");
  assert.equal(totals.qualified, 1);
  assert.equal(totals.failed, 1);
  assert.equal(totals.challengerRan, 1);
  assert.equal(totals.extractionInputTokens, 3000);
  assert.equal(totals.challengerInputTokens, 8000);
  assert.equal(totals.challengerModel, "claude-opus-5");
  assert.equal(totals.complete, false, "a queued lead means the run is still going");
});

test("a run is complete once no lead is queued or running", () => {
  const done = {
    stage: "done", status: "ok", decision: "review", extraction_ok: true, challenger_ran: false,
    extraction_model: "claude-haiku-4-5", challenger_model: null,
    extraction_input_tokens: 1, extraction_output_tokens: 1,
    challenger_input_tokens: 0, challenger_output_tokens: 0, total_ms: 10,
  } satisfies RunTotalsLead;
  assert.equal(deriveRunTotals([done, done]).complete, true);
});

test("a finished lead is never reported as stuck in the terminal slot", () => {
  // Regression: every completed run eventually claimed "Jammed at Stored",
  // because a stored decision sits in `done` forever and the elapsed-time check
  // did not exempt the terminal slot.
  const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const finished: SlotLeadRecord = {
    stage: "done", status: "ok", stage_entered_at: longAgo, extraction_ok: true,
    decision: "review", mode: null,
  };
  const slots = computeSlots([finished, finished, finished]);
  const stored = slots.find((s) => s.key === "done")!;
  assert.equal(stored.active, 3);
  assert.equal(stored.stuck, 0, "finished is not stuck");
  assert.equal(findJam(slots), null, "a fully completed run has no jam");
});

test("a pre-filtered lead's trace names the skip instead of implying lost evidence", () => {
  const stages = deriveStages({
    runLead: runLead({ status: "skipped", acquisition_source: null, extraction_ok: null }),
    snapshot: null,
    extraction: null,
    decision: null,
  });

  const acquisition = stageBy(stages, "acquisition");
  assert.equal(acquisition.state, "blocked", "a deliberate drop is not a defect");
  assert.match(acquisition.headline, /no bio link/i);
  assert.equal(acquisition.recorded, true, "we know exactly why this stopped");
  assert.equal(
    stageBy(stages, "extraction").headline,
    "Not reached",
    "nothing downstream of the skip ran",
  );
});

test("a pre-filtered lead is blocked at the pre-filter slot, never failed", () => {
  // Colouring a correct drop red is the fastest way to teach people to ignore
  // red — the same reason hard_excluded is counted as blocked.
  const now = new Date().toISOString();
  const slots = computeSlots([
    { stage: "prefilter", status: "skipped", stage_entered_at: now, extraction_ok: null, decision: null, mode: null },
    { stage: "done", status: "ok", stage_entered_at: now, extraction_ok: true, decision: "qualified", mode: "auto_approved" },
  ]);

  const prefilter = slots.find((s) => s.key === "prefilter")!;
  assert.equal(prefilter.blocked, 1);
  assert.equal(prefilter.failed, 0, "a skip is the pipeline working, not breaking");
  assert.equal(prefilter.active, 0, "a skipped lead is not still being worked on");
  assert.equal(prefilter.entered, 2, "the survivor passed through here too");
});

test("a skipped lead sitting at the pre-filter never reads as stuck", () => {
  // It parks there permanently, so elapsed time means "dropped a while ago".
  const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const slots = computeSlots([
    { stage: "prefilter", status: "skipped", stage_entered_at: longAgo, extraction_ok: null, decision: null, mode: null },
  ]);
  assert.equal(slots.find((s) => s.key === "prefilter")!.stuck, 0);
});

test("deliberate pre-filter drops do not raise a jam", () => {
  /*
   * Regression guard for the fix that shipped with the pre-filter: findJam's
   * drop-detection fallback compared raw `entered` counts, so seven skipped
   * leads read as "7 lead(s) did not reach Acquisition" on a perfectly healthy
   * run — a false alarm on every run the filter did its job.
   */
  const now = new Date().toISOString();
  const skipped: SlotLeadRecord = {
    stage: "prefilter", status: "skipped", stage_entered_at: now,
    extraction_ok: null, decision: null, mode: null,
  };
  const finished: SlotLeadRecord = {
    stage: "done", status: "ok", stage_entered_at: now, extraction_ok: true,
    decision: "qualified", mode: "auto_approved",
  };

  const slots = computeSlots([skipped, skipped, skipped, finished, finished]);
  assert.equal(findJam(slots), null, "skipping is not jamming");
});

test("a run that is merely still going is not reported as jammed", () => {
  /*
   * The other half of the same fix. A lead in flight has not "failed to reach"
   * the next slot, it just has not got there yet — but the fallback compared
   * raw entered counts, so a run reported itself jammed seconds after starting.
   * An acquisition failure is already red on its own slot and is not a mystery
   * either.
   */
  const now = new Date().toISOString();
  const slots = computeSlots([
    { stage: "prefilter", status: "skipped", stage_entered_at: now, extraction_ok: null, decision: null, mode: null },
    { stage: "acquiring", status: "acquisition_failed", stage_entered_at: now, extraction_ok: null, decision: null, mode: null },
    { stage: "extracting", status: "running", stage_entered_at: now, extraction_ok: null, decision: null, mode: null },
  ]);

  assert.equal(slots.find((s) => s.key === "acquiring")!.failed, 1, "the failure is still visible");
  assert.equal(findJam(slots), null, "visible and explained is not jammed");
});

test("run totals report pre-filter skips separately from failures", () => {
  const lead = (over: Partial<RunTotalsLead>): RunTotalsLead => ({
    stage: "done", status: "ok", decision: "review", extraction_ok: true, challenger_ran: false,
    extraction_model: "claude-haiku-4-5", challenger_model: null,
    extraction_input_tokens: 1000, extraction_output_tokens: 100,
    challenger_input_tokens: 0, challenger_output_tokens: 0, total_ms: 30000, ...over,
  });
  const dropped = lead({
    stage: "prefilter", status: "skipped", decision: null, extraction_ok: null,
    extraction_model: null, extraction_input_tokens: 0, extraction_output_tokens: 0, total_ms: null,
  });

  const totals = deriveRunTotals([lead({ decision: "qualified" }), dropped, dropped], 3);

  assert.equal(totals.skipped, 2);
  assert.equal(totals.failed, 0, "a skip counted as a failure would read every run as broken");
  assert.equal(totals.processed, 3, "a skipped lead is terminal — the run is done with it");
  assert.equal(totals.complete, true, "nothing is queued or running");
});

test("a lead genuinely parked mid-pipeline is still reported as stuck", () => {
  const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const parked: SlotLeadRecord = {
    stage: "acquiring", status: "running", stage_entered_at: longAgo,
    extraction_ok: null, decision: null, mode: null,
  };
  const slots = computeSlots([parked]);
  assert.equal(slots.find((s) => s.key === "acquiring")!.stuck, 1);
  assert.equal(findJam(slots)?.slot.key, "acquiring");
});
