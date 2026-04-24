"use server";
import { revalidatePath } from "next/cache";
import { inngest } from "@/inngest/client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ProcessLeadResponse = {
  ok: boolean;
  error?: string;
  job_id?: string;
};

// Manually trigger the full process-profile pipeline (scrape profile+posts,
// hard filter, metrics, AI classify, score, persist) for a single `pending`
// lead. Fires `crawl/profile.discovered`; Inngest picks it up.
export async function processLead(leadId: string): Promise<ProcessLeadResponse> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const admin = createAdminClient();
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, username, crawl_depth, source_seed_id, parent_username")
    .eq("id", leadId)
    .single();
  if (leadErr || !lead) return { ok: false, error: leadErr?.message ?? "lead not found" };

  // Create a one-off crawl_job so process-profile's job-status checks +
  // counter bumps have something to write to.
  const { data: job, error: jobErr } = await admin
    .from("crawl_jobs")
    .insert({
      seed_id: lead.source_seed_id, // may be null for manually-added leads
      status: "running",
      max_depth: lead.crawl_depth,
      current_depth: lead.crawl_depth,
      expected_profiles: 1,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobErr || !job) return { ok: false, error: jobErr?.message ?? "could not create crawl_job" };

  await inngest.send({
    name: "crawl/profile.discovered",
    data: {
      crawl_job_id: job.id,
      seed_id: lead.source_seed_id,
      username: lead.username,
      depth: lead.crawl_depth,
      parent_username: lead.parent_username,
    },
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${lead.username}`);
  return { ok: true, job_id: job.id };
}
