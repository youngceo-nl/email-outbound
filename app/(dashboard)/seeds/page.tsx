import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeedManager } from "@/components/seeds/seed-manager";
import { CrawlJobsList } from "@/components/seeds/crawl-jobs-list";
import { getSettings } from "@/lib/config/settings";

export const dynamic = "force-dynamic";

export default async function SeedsPage() {
  const sb = createAdminClient();
  const [{ data: seeds }, { data: jobs }, settings] = await Promise.all([
    sb.from("seeds").select("*").order("created_at", { ascending: false }),
    sb.from("crawl_jobs").select("*, seeds(username)").order("created_at", { ascending: false }).limit(15),
    getSettings(),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Source Accounts</h1>
        <p className="text-sm text-muted-foreground">
          These are the Instagram accounts we start from. Each one kicks off a search through the people
          they follow — and, for the best matches, the people <em>those</em> people follow.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Your source accounts</CardTitle></CardHeader>
        <CardContent>
          <SeedManager
            seeds={seeds ?? []}
            jobs={jobs ?? []}
            defaultLimit={settings.max_profiles_per_account}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent searches</CardTitle></CardHeader>
        <CardContent>
          <CrawlJobsList jobs={jobs ?? []} />
        </CardContent>
      </Card>
    </div>
  );
}
