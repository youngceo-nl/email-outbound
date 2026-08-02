import type { AcquisitionPoolEntry } from "@/lib/instagram/cookie-pool";
import type { AcquisitionStatus } from "@/lib/instagram/steel-acquisition";

export function selectAcquisitionIdentity(
  pool: AcquisitionPoolEntry[],
  eventIndex: number,
): AcquisitionPoolEntry {
  if (pool.length === 0) throw new Error("No complete Instagram acquisition identity is available");
  const index = ((eventIndex % pool.length) + pool.length) % pool.length;
  return pool[index];
}

export function qualificationEventForAcquisition(input: {
  status: AcquisitionStatus;
  leadId: string;
  snapshotId: string | null;
  crawlJobId: string | null;
  /* Carried so a test run stays attributable across the acquire → qualify hop. */
  runId?: string | null;
}) {
  if (input.status !== "captured" || !input.snapshotId) return null;
  return {
    name: "lead/qualification.requested" as const,
    data: {
      lead_id: input.leadId,
      evidence_snapshot_id: input.snapshotId,
      crawl_job_id: input.crawlJobId,
      run_id: input.runId ?? null,
    },
  };
}

export function buildProfileAcquisitionEvents(
  leads: Array<{ id: string; username: string }>,
  crawlJobId: string | null,
  runId: string | null = null,
) {
  return leads.map((lead, eventIndex) => ({
    name: "lead/profile-acquisition.requested" as const,
    data: {
      lead_id: lead.id,
      username: lead.username,
      crawl_job_id: crawlJobId,
      event_index: eventIndex,
      run_id: runId,
    },
  }));
}
