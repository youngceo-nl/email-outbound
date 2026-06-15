// Runs automatically before `npm run dev` (see package.json "predev").
// Crawl jobs are executed by the Inngest worker. If the worker wasn't running
// when a job was queued (or it crashed mid-run), the job is orphaned and sits
// in "queued"/"running" forever. On startup nothing is running yet, so any job
// still in those states is by definition stale — mark it failed so the UI is
// honest and you can cleanly re-trigger. Never blocks dev startup: any error
// (e.g. missing env) just logs and exits 0.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("[reset-stuck-jobs] Supabase env not set — skipping.");
  process.exit(0);
}

try {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("crawl_jobs")
    .update({
      status: "failed",
      error_message: "Reset on startup: orphaned (worker was not running).",
      finished_at: new Date().toISOString(),
    })
    .in("status", ["queued", "running"])
    .select("id");
  if (error) {
    console.log(`[reset-stuck-jobs] query failed (non-fatal): ${error.message}`);
  } else {
    console.log(`[reset-stuck-jobs] reset ${data?.length ?? 0} orphaned job(s).`);
  }
} catch (err) {
  console.log(`[reset-stuck-jobs] error (non-fatal): ${err?.message ?? err}`);
}
process.exit(0);
