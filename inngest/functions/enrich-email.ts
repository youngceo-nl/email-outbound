import { inngest } from "@/inngest/client";
import { enrichLeadPipeline } from "@/lib/pipeline/enrich-pipeline";
import { getJobStatus, logError } from "@/lib/pipeline/persist";

export const enrichEmail = inngest.createFunction(
  {
    id: "enrich-email",
    name: "Enrich lead with LinkedIn + AirScale email",
    retries: 2,
    concurrency: [
      { limit: 4, key: "event.data.crawl_job_id" },
      { limit: 8 },
    ],
  },
  { event: "lead/email.enrich.requested" },
  async ({ event, step }) => {
    const { lead_id, crawl_job_id } = event.data;

    if (crawl_job_id) {
      const status = await step.run("check-job-status", () => getJobStatus(crawl_job_id));
      if (status === "cancelled" || status === "failed") {
        return { skipped: status };
      }
    }

    try {
      const r = await step.run("enrich", () => enrichLeadPipeline({ leadId: lead_id }));
      return { ok: r.ok, source: r.source, email: r.email, linkedin: r.linkedin_url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logError({
        context: "enrich.email",
        error_message: msg,
        payload: { lead_id },
        crawl_job_id: crawl_job_id ?? null,
      });
      throw err;
    }
  },
);
