import assert from "node:assert/strict";
import test from "node:test";
import type { AcquisitionPoolEntry } from "../../lib/instagram/cookie-pool";
import {
  qualificationEventForAcquisition,
  selectAcquisitionIdentity,
} from "../../lib/pipeline/canonical-events";

const identities: AcquisitionPoolEntry[] = [
  { cookie: "a", proxyUrl: "http://p1", accountUsername: "one", steelProfileId: "s1" },
  { cookie: "b", proxyUrl: "http://p2", accountUsername: "two", steelProfileId: "s2" },
];

test("selects one complete identity deterministically", () => {
  assert.equal(selectAcquisitionIdentity(identities, 0).accountUsername, "one");
  assert.equal(selectAcquisitionIdentity(identities, 1).accountUsername, "two");
  assert.equal(selectAcquisitionIdentity(identities, 2).accountUsername, "one");
});

test("refuses acquisition when no complete identity exists", () => {
  assert.throws(() => selectAcquisitionIdentity([], 0), /no complete Instagram acquisition identity/i);
});

test("emits qualification only after a captured snapshot exists", () => {
  assert.deepEqual(
    qualificationEventForAcquisition({
      status: "captured",
      leadId: "lead-1",
      snapshotId: "snapshot-1",
      crawlJobId: "crawl-1",
    }),
    {
      name: "lead/qualification.requested",
      data: {
        lead_id: "lead-1",
        evidence_snapshot_id: "snapshot-1",
        crawl_job_id: "crawl-1",
      },
    },
  );
});

test("never emits qualification for a failed or challenged acquisition", () => {
  for (const status of ["failed", "blocked", "challenge"] as const) {
    assert.equal(
      qualificationEventForAcquisition({
        status,
        leadId: "lead-1",
        snapshotId: null,
        crawlJobId: null,
      }),
      null,
    );
  }
});
