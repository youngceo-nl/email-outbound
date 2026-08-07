// Runs automatically before `npm run dev` (see package.json "predev").
// Crawl jobs are executed by the Inngest worker. If the worker wasn't running
// when a job was queued (or it crashed mid-run), the job is orphaned and sits
// in "queued"/"running" forever — mark it failed so the UI is honest and you
// can cleanly re-trigger. Never blocks dev startup: any error (e.g. missing
// env) just logs and exits 0.
//
// Only jobs older than STALE_AFTER_MS are touched. This used to reset EVERY
// queued/running job on the premise that "on startup nothing is running yet",
// which stopped being true once the self-hosted production container started
// running 24/7 against this same database: starting a local dev server then
// killed whatever production was mid-crawl, and the job died with this
// script's own "orphaned" message and no error of its own — which is exactly
// how it went unnoticed. A job that started seconds ago is not orphaned no
// matter which process is booting.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.log("[reset-stuck-jobs] Supabase env not set — skipping.");
  process.exit(0);
}

/*
 * Comfortably longer than any healthy crawl step. A full following walk paces
 * itself (seconds of jittered delay between cursor pages) and can legitimately
 * run for many minutes, so this is deliberately generous: leaving a genuinely
 * dead job marked "running" for an extra hour is a cosmetic problem, while
 * killing a live one destroys real work.
 */
const STALE_AFTER_MS = 60 * 60 * 1000;

try {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data, error } = await sb
    .from("crawl_jobs")
    .update({
      status: "failed",
      error_message: "Reset on startup: orphaned (worker was not running).",
      finished_at: new Date().toISOString(),
    })
    .in("status", ["queued", "running"])
    .lt("created_at", cutoff)
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
