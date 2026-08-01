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
}) {
  if (input.status !== "captured" || !input.snapshotId) return null;
  return {
    name: "lead/qualification.requested" as const,
    data: {
      lead_id: input.leadId,
      evidence_snapshot_id: input.snapshotId,
      crawl_job_id: input.crawlJobId,
    },
  };
}
