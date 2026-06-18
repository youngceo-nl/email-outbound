"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
}

export async function getCrawlJobProgress(job_id: string): Promise<{ scraped: number; total: number; status: string }> {
  await requireUser();
  const sb = createAdminClient();
  const { data } = await sb
    .from("crawl_jobs")
    .select("profiles_scraped, expected_profiles, status")
    .eq("id", job_id)
    .single();
  return {
    scraped: data?.profiles_scraped ?? 0,
    total: data?.expected_profiles ?? 0,
    status: data?.status ?? "unknown",
  };
}

export async function cancelCrawl(job_id: string) {
  await requireUser();
  const sb = createAdminClient();
  const { data: job } = await sb.from("crawl_jobs").select("status").eq("id", job_id).single();
  if (!job) return { error: "job_not_found" };
  if (job.status !== "running" && job.status !== "queued") {
    return { error: `cannot cancel job in status: ${job.status}` };
  }
  const { error } = await sb
    .from("crawl_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", job_id);
  if (error) return { error: error.message };
  revalidatePath("/seeds");
  revalidatePath(`/seeds/jobs/${job_id}`);
  return { ok: true };
}

export async function retryCrawl(job_id: string) {
  await requireUser();
  const admin = createAdminClient();
  const { data: prev } = await admin
    .from("crawl_jobs")
    .select("seed_id, status, max_depth")
    .eq("id", job_id)
    .single();
  if (!prev) return { error: "job_not_found" };
  if (prev.status !== "failed" && prev.status !== "cancelled") {
    return { error: `cannot retry job in status: ${prev.status}` };
  }

  const { data: seed } = await admin
    .from("seeds")
    .select("id, username, max_profiles_to_scrape")
    .eq("id", prev.seed_id)
    .single();
  if (!seed) return { error: "seed_not_found" };

  const { data: job, error: jobErr } = await admin
    .from("crawl_jobs")
    .insert({ seed_id: seed.id, status: "queued", max_depth: prev.max_depth })
    .select("id")
    .single();
  if (jobErr || !job) return { error: jobErr?.message ?? "job_create_failed" };

  const { ids } = await inngest.send({
    name: "crawl/seed.requested",
    data: {
      crawl_job_id: job.id,
      seed_id: seed.id,
      seed_username: seed.username,
      profile_limit: seed.max_profiles_to_scrape ?? null,
    },
  });
  await admin.from("crawl_jobs").update({ inngest_run_id: ids[0] ?? null }).eq("id", job.id);
  revalidatePath("/seeds");
  return { ok: true, crawl_job_id: job.id };
}
