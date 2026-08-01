/* Compatibility adapter for legacy lead/score.requested callers. */
import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

/** Retained for callers and tests that use deterministic shadow sampling. */
export function inShadowSample(leadId: string, samplePct: number): boolean {
  if (samplePct <= 0) return false;
  if (samplePct >= 100) return true;
  let hash = 2166136261;
  for (let i = 0; i < leadId.length; i++) {
    hash ^= leadId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < samplePct;
}

export const scoreLead = inngest.createFunction(
  {
    id: "score-lead",
    name: "Adapt legacy scoring to canonical qualification",
    retries: 2,
  },
  { event: "lead/score.requested" },
  async ({ event, step }) => {
    const { lead_id, crawl_job_id = null } = event.data;
    const resolved = await step.run("resolve-canonical-input", async () => {
      const sb = createAdminClient();
      const [{ data: lead, error: leadError }, { data: snapshot, error: snapshotError }] =
        await Promise.all([
          sb.from("leads").select("id, username").eq("id", lead_id).single(),
          sb
            .from("lead_evidence_snapshots")
            .select("id")
            .eq("lead_id", lead_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      if (leadError || !lead) throw new Error(leadError?.message ?? "lead not found");
      if (snapshotError) throw new Error(snapshotError.message);
      return { lead: lead as { id: string; username: string }, snapshotId: snapshot?.id as string | undefined };
    });

    if (resolved.snapshotId) {
      await step.sendEvent("request-canonical-qualification", {
        name: "lead/qualification.requested" as const,
        data: {
          lead_id,
          evidence_snapshot_id: resolved.snapshotId,
          crawl_job_id,
        },
      });
      return { queued: "qualification", snapshot_id: resolved.snapshotId };
    }

    await step.sendEvent("request-canonical-acquisition", {
      name: "lead/profile-acquisition.requested" as const,
      data: {
        lead_id,
        username: resolved.lead.username,
        crawl_job_id,
        event_index: 0,
      },
    });
    return { queued: "acquisition" };
  },
);
