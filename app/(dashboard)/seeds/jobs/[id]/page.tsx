import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ChevronLeft } from "lucide-react";
import { JobDetailLive } from "@/components/seeds/job-detail-live";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = createAdminClient();

  const { data: job } = await sb
    .from("crawl_jobs")
    .select("*, seeds(username)")
    .eq("id", id)
    .single();
  if (!job) notFound();

  const [{ data: events }, { data: errors }, { data: leads }] = await Promise.all([
    sb.from("crawl_logs").select("*").eq("crawl_job_id", id).order("created_at", { ascending: false }).limit(300),
    sb.from("error_logs").select("*").eq("crawl_job_id", id).order("created_at", { ascending: false }).limit(50),
    sb
      .from("leads")
      .select("id, username, status, overall_score, niche, crawl_depth, parent_username, created_at")
      .eq("source_seed_id", job.seed_id)
      .gte("created_at", job.created_at)
      .order("overall_score", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);

  return (
    <div className="p-6 space-y-6">
      <Link href="/seeds" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4 mr-1" /> Back to source accounts
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Search from @{job.seeds?.username ?? "—"}
        </h1>
        <p className="text-sm text-muted-foreground font-mono">{job.id}</p>
      </div>

      <JobDetailLive
        jobId={job.id}
        seedId={job.seed_id}
        jobCreatedAt={job.created_at}
        initialJob={job}
        initialEvents={events ?? []}
        initialErrors={errors ?? []}
        initialLeads={leads ?? []}
      />
    </div>
  );
}
