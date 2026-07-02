import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";

// score-lead's own retries:2 already covers transient blips. Once that's
// exhausted on a rate-limit/quota error, the lead is left at status:"pending"
// forever with no further attempt. This periodically re-queues just those —
// not leads that are pending because they're simply new/unprocessed, and not
// leads a hard/metrics filter legitimately rejected (those already moved to
// status:"rejected" and are untouched here).
export const retryBlockedLeads = inngest.createFunction(
  { id: "retry-blocked-leads", name: "Retry leads blocked by API limits" },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const toRetry = await step.run("find-blocked-leads", async () => {
      const sb = createAdminClient();
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60_000).toISOString();

      const { data: errors } = await sb
        .from("error_logs")
        .select("payload, crawl_job_id, created_at")
        .eq("context", "score-lead.classify")
        .gte("created_at", sixHoursAgo)
        .or("error_message.ilike.%429%,error_message.ilike.%quota%,error_message.ilike.%rate limit%,error_message.ilike.%rate-limited%")
        .order("created_at", { ascending: false })
        .limit(500);

      const byLead = new Map<string, { crawl_job_id: string | null; attempts: number }>();
      for (const e of errors ?? []) {
        const leadId = (e.payload as { lead_id?: string } | null)?.lead_id;
        if (!leadId) continue;
        const entry = byLead.get(leadId) ?? { crawl_job_id: e.crawl_job_id ?? null, attempts: 0 };
        entry.attempts += 1;
        byLead.set(leadId, entry);
      }

      if (byLead.size === 0) return [];

      const leadIds = [...byLead.keys()];
      const { data: leads } = await sb
        .from("leads")
        .select("id, status, overall_score")
        .in("id", leadIds);

      // Only leads still stuck pending (never succeeded on a later attempt)
      // and not hammered so many times it's clearly not just a rate limit.
      return (leads ?? [])
        .filter((l) => l.status === "pending" && l.overall_score == null && (byLead.get(l.id)?.attempts ?? 0) < 8)
        .map((l) => ({ lead_id: l.id as string, crawl_job_id: byLead.get(l.id)?.crawl_job_id ?? null }));
    });

    if (toRetry.length > 0) {
      await step.sendEvent(
        "requeue-blocked",
        toRetry.map((t) => ({
          name: "lead/score.requested" as const,
          data: { lead_id: t.lead_id, crawl_job_id: t.crawl_job_id, force: false },
        })),
      );
    }

    return { requeued: toRetry.length };
  },
);
