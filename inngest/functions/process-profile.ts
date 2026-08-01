/* Compatibility adapter for callers that still emit crawl/profile.discovered. */
import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildProfileAcquisitionEvents } from "@/lib/pipeline/canonical-events";

export const processProfile = inngest.createFunction(
  {
    id: "process-profile",
    name: "Adapt discovered profile to canonical acquisition",
    retries: 2,
  },
  { event: "crawl/profile.discovered" },
  async ({ event, step }) => {
    const { username, crawl_job_id } = event.data;
    const lead = await step.run("resolve-lead", async () => {
      const sb = createAdminClient();
      const { data, error } = await sb
        .from("leads")
        .select("id, username")
        .eq("username", username)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as { id: string; username: string } | null;
    });
    if (!lead) return { skipped: "lead_not_found" };

    const [next] = buildProfileAcquisitionEvents([lead], crawl_job_id);
    await step.sendEvent("request-profile-acquisition", next);
    return { queued: 1, lead_id: lead.id };
  },
);
