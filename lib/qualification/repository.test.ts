import assert from "node:assert/strict";
import test from "node:test";
import type { ExtractionResult } from "./extract";
import {
  operationalStatusForDecision,
  saveQualificationRun,
} from "./repository";
import type { CommercialDecision, EvidenceSnapshot } from "./types";

test("persists snapshot, extraction, decision, then lead projection in order", async () => {
  const calls: string[] = [];
  const result = await saveQualificationRun({
    leadId: "lead-1",
    snapshot: { username: "creator" } as EvidenceSnapshot,
    extraction: { ok: true } as ExtractionResult,
    decision: { decision: "qualified" } as CommercialDecision,
    operations: {
      saveSnapshot: async () => {
        calls.push("snapshot");
        return { id: "snapshot-1" };
      },
      saveExtraction: async ({ evidenceSnapshotId }) => {
        assert.equal(evidenceSnapshotId, "snapshot-1");
        calls.push("extraction");
        return { id: "extraction-1" };
      },
      saveDecision: async ({ evidenceSnapshotId, extractionId }) => {
        assert.equal(evidenceSnapshotId, "snapshot-1");
        assert.equal(extractionId, "extraction-1");
        calls.push("decision");
        return { id: "decision-1" };
      },
      projectLead: async ({ decisionId }) => {
        assert.equal(decisionId, "decision-1");
        calls.push("projection");
      },
    },
  });

  assert.deepEqual(calls, ["snapshot", "extraction", "decision", "projection"]);
  assert.deepEqual(result, {
    snapshotId: "snapshot-1",
    extractionId: "extraction-1",
    decisionId: "decision-1",
  });
});

test("persists terminal pre-AI decisions without inventing an extraction", async () => {
  const calls: string[] = [];
  await saveQualificationRun({
    leadId: "lead-1",
    snapshot: { username: "creator" } as EvidenceSnapshot,
    extraction: null,
    decision: { decision: "data_retry" } as CommercialDecision,
    operations: {
      saveSnapshot: async () => ({ id: "snapshot-1" }),
      saveExtraction: async () => {
        calls.push("extraction");
        return { id: "unexpected" };
      },
      saveDecision: async ({ extractionId }) => {
        assert.equal(extractionId, null);
        return { id: "decision-1" };
      },
      projectLead: async () => undefined,
    },
  });
  assert.deepEqual(calls, []);
});

test("reuses an existing durable snapshot without inserting a duplicate", async () => {
  const calls: string[] = [];
  const result = await saveQualificationRun({
    leadId: "lead-1",
    existingSnapshotId: "snapshot-existing",
    snapshot: { username: "creator" } as EvidenceSnapshot,
    extraction: { ok: true } as ExtractionResult,
    decision: { decision: "review" } as CommercialDecision,
    operations: {
      saveSnapshot: async () => {
        calls.push("snapshot");
        return { id: "duplicate" };
      },
      saveExtraction: async () => ({ id: "extraction-1" }),
      saveDecision: async ({ evidenceSnapshotId }) => {
        assert.equal(evidenceSnapshotId, "snapshot-existing");
        return { id: "decision-1" };
      },
      projectLead: async () => undefined,
    },
  });
  assert.deepEqual(calls, []);
  assert.equal(result.snapshotId, "snapshot-existing");
});

test("data retry remains pending and is never projected as rejected", () => {
  assert.equal(operationalStatusForDecision("data_retry"), "pending");
  assert.equal(operationalStatusForDecision("qualified"), "qualified");
  assert.equal(operationalStatusForDecision("review"), "review");
  assert.equal(operationalStatusForDecision("rejected"), "rejected");
});
