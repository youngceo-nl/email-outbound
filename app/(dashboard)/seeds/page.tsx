import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SeedManager } from "@/components/seeds/seed-manager";
import { CrawlJobsList } from "@/components/seeds/crawl-jobs-list";
import { BioCoverageCard } from "@/components/seeds/bio-coverage";
import { RecommendedSeeds } from "@/components/seeds/recommended-seeds";
import { BadSeedsTable } from "@/components/seeds/bad-seeds-table";
import { getSettings } from "@/lib/config/settings";
import { getBioCoverage } from "@/app/actions/backfill-bios";
import { getScrapedSeedIds } from "@/lib/seeds/scraped";
import { getRecommendedSeeds } from "@/lib/seeds/recommend";

export const dynamic = "force-dynamic";

export default async function SeedsPage() {
  const sb = createAdminClient();
  const [{ data: allSeeds }, { data: jobs }, settings, coverage, scrapedSeedIds, recommended, { data: rejectedSeeds }] = await Promise.all([
    sb.from("seeds").select("*").order("created_at", { ascending: false }),
    sb.from("crawl_jobs").select("*, seeds(username)").order("created_at", { ascending: false }).limit(15),
    getSettings(),
    getBioCoverage(),
    getScrapedSeedIds(),
    getRecommendedSeeds(5),
    sb.from("rejected_seeds").select("username, reason, created_at").order("created_at", { ascending: false }),
  ]);

  const seeds = (allSeeds ?? []).filter((s) => !(s.exhausted_providers as string[])?.includes("cookie"));
  const exhaustedSeeds = (allSeeds ?? []).filter((s) => (s.exhausted_providers as string[])?.includes("cookie"));

  const cookieSet = !!(settings.instagram_session_cookie?.trim() || process.env.INSTAGRAM_SESSION_COOKIE?.trim());

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add Profiles to Scrape</h1>
        <p className="text-sm text-muted-foreground">
          Add an Instagram profile below and we&rsquo;ll search through who they follow — and for the best
          matches, who <em>those</em> people follow too — to find new leads.
        </p>
      </div>

      <RecommendedSeeds candidates={recommended} />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Profiles you&rsquo;re scraping from</CardTitle>
            <Link href="/seeds/history" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">
              View all accounts ever used →
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <SeedManager
            seeds={seeds ?? []}
            exhaustedSeeds={exhaustedSeeds}
            jobs={jobs ?? []}
            scrapedSeedIds={[...scrapedSeedIds]}
            systemStatus={{
              igStatus: (() => {
                const igConfigured = (settings.instagram_accounts ?? []).length > 0 || (settings.instagram_session_cookies ?? []).length > 0 || !!settings.instagram_session_cookie;
                return !igConfigured ? "missing" as const
                  : settings.ig_cookie_status === "dead" ? "dead" as const
                  : settings.ig_cookie_status === "live" ? "ok" as const
                  : "unknown" as const;
              })(),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Missing bios</CardTitle>
          <CardDescription>
            We pull each lead&rsquo;s bio automatically once they&rsquo;re found. If any slipped through,
            fetch the missing ones here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <BioCoverageCard initial={coverage} />
          {!cookieSet && (
            <p className="text-xs text-amber-600">
              No Instagram account connected, so bios use paid lookups instead (or fail). Connect one in{" "}
              <Link href="/settings" className="underline">Settings</Link> to fetch bios for free.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent searches</CardTitle></CardHeader>
        <CardContent>
          <CrawlJobsList jobs={jobs ?? []} />
        </CardContent>
      </Card>

      <BadSeedsTable rows={rejectedSeeds ?? []} />
    </div>
  );
}
