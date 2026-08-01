import { createClient } from "@supabase/supabase-js";

function value(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  const username = value("username")?.replace(/^@/, "") ?? null;
  const since = value("since") ?? new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  let logsQuery = sb.from("crawl_logs").select("action,status,detail,created_at,profile_username").gte("created_at", since);
  let snapshotsQuery = sb.from("lead_evidence_snapshots").select("id,username,created_at").gte("created_at", since);
  if (username) {
    logsQuery = logsQuery.eq("profile_username", username);
    snapshotsQuery = snapshotsQuery.eq("username", username);
  }
  const [{ data: logs, error: logError }, { data: snapshots, error: snapshotError }] = await Promise.all([
    logsQuery.order("created_at", { ascending: true }).limit(2000),
    snapshotsQuery.order("created_at", { ascending: true }).limit(500),
  ]);
  if (logError) throw new Error(logError.message);
  if (snapshotError) throw new Error(snapshotError.message);

  const snapshotIds = (snapshots ?? []).map((row) => row.id);
  const decisions = snapshotIds.length
    ? await sb.from("lead_qualification_decisions").select("id,evidence_snapshot_id,decision,created_at").in("evidence_snapshot_id", snapshotIds)
    : { data: [], error: null };
  if (decisions.error) throw new Error(decisions.error.message);

  const byAction: Record<string, number> = {};
  for (const log of logs ?? []) byAction[log.action] = (byAction[log.action] ?? 0) + 1;
  console.log(JSON.stringify({
    since,
    username,
    stages: byAction,
    snapshots: snapshots?.length ?? 0,
    decisions: decisions.data?.length ?? 0,
  }, null, 2));

  const acquired = byAction.profile_acquired ?? 0;
  if (acquired > 0 && (snapshots?.length ?? 0) === 0) {
    throw new Error("FAIL: acquisition logs exist without durable snapshots");
  }
  if ((snapshots?.length ?? 0) > 0 && (decisions.data?.length ?? 0) === 0) {
    throw new Error("FAIL: snapshots exist without qualification decisions");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
