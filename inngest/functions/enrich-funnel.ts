import { inngest } from "@/inngest/client";
import { enrichFunnelForLead } from "@/lib/funnel/enrich";
import { getJobStatus, logError } from "@/lib/pipeline/persist";

export const enrichFunnel = inngest.createFunction(
  {
    id: "enrich-funnel",
    name: "Enrich lead with funnel/program info",
    retries: 2,
    concurrency: [
      { limit: 4, key: "event.data.crawl_job_id" },
      { limit: 8 },
    ],
  },
  { event: "lead/funnel.enrich.requested" },
  async ({ event, step }) => {
    const { lead_id, external_link, crawl_job_id } = event.data;

    if (crawl_job_id) {
      const status = await step.run("check-job-status", () => getJobStatus(crawl_job_id));
      if (status === "cancelled" || status === "failed") {
        return { skipped: status };
      }
    }

    try {
      const result = await step.run("enrich-funnel", () =>
        enrichFunnelForLead({ leadId: lead_id, externalLink: external_link }),
      );
      return { ok: result.ok, platform: result.funnel_platform, program: result.funnel_program_name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logError({
        context: "enrich.funnel",
        error_message: msg,
        payload: { lead_id, external_link },
        crawl_job_id: crawl_job_id ?? null,
      });
      throw err;
    }
  },
);
