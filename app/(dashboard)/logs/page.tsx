import { createAdminClient } from "@/lib/supabase/admin";
import { LogsLive } from "@/components/logs/logs-live";

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const sb = createAdminClient();
  const [{ data: crawl }, { data: errors }] = await Promise.all([
    sb.from("crawl_logs").select("*").order("created_at", { ascending: false }).limit(200),
    sb.from("error_logs").select("*").order("created_at", { ascending: false }).limit(100),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">A live feed of everything the searches are doing, plus any problems.</p>
      </div>

      <LogsLive initialCrawl={crawl ?? []} initialErrors={errors ?? []} />
    </div>
  );
}
