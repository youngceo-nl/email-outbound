import { inngest } from "@/inngest/client";
import { scrapeSkoolCommunity } from "@/lib/platforms/skool";
import { analyzeIgLead } from "@/lib/manual-lead/analyze";
import { logCrawl, bumpJobCounters } from "@/lib/pipeline/persist";
import { createAdminClient } from "@/lib/supabase/admin";

// bumpJobCounters never flips crawl_jobs.status on its own — without this the
// job (and its progress card) would show "running" forever once every
// community has been processed.
async function completeIfDone(crawl_job_id: string) {
  const sb = createAdminClient();
  const { data } = await sb.from("crawl_jobs").select("expected_profiles, profiles_scraped").eq("id", crawl_job_id).single();
  if (data && data.expected_profiles != null && data.profiles_scraped >= data.expected_profiles) {
    await sb.from("crawl_jobs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", crawl_job_id);
  }
}

// One community from a Skool CSV export -> find the owner's real Instagram
// (via the group's `link_instagram` field, not a generic page-wide regex) ->
// run it through the same scrape+score pipeline the Telegram bot uses.
// bumpJobCounters keeps crawl_jobs.profiles_scraped/qualified_count/
// rejected_count current so the UI can show live progress off that row.
export const skoolImport = inngest.createFunction(
  {
    id: "skool-import",
    name: "Import lead from Skool community",
    retries: 1,
    concurrency: [
      { limit: 3, key: "event.data.crawl_job_id" },
      { limit: 6 },
    ],
  },
  { event: "skool/community.discovered" },
  async ({ event, step }) => {
    const { crawl_job_id, slug, name } = event.data;

    const scraped = await step.run("scrape-skool-page", () => scrapeSkoolCommunity(slug));

    if ("error" in scraped || !scraped.instagram) {
      await step.run("log-no-instagram", () =>
        logCrawl({
          crawl_job_id,
          profile_username: slug,
          parent_username: null,
          action: "skool_no_instagram",
          depth: 0,
          detail: name,
        }),
      );
      await step.run("bump-scraped", () => bumpJobCounters({ crawl_job_id, scraped: 1 }));
      await step.run("maybe-complete", () => completeIfDone(crawl_job_id));
      return { status: "no_instagram" };
    }

    const username = scraped.instagram;
    const result = await step.run("analyze-lead", () => analyzeIgLead(username, "skool_csv"));

    await step.run("log-result", () =>
      logCrawl({
        crawl_job_id,
        profile_username: username,
        parent_username: slug,
        action: result.ok ? "skool_scored" : result.duplicate ? "skool_duplicate" : "skool_failed",
        depth: 0,
        detail: result.ok
          ? `score=${result.score.overall_score} action=${result.score.recommended_action} members=${scraped.totalMembers ?? "?"}`
          : result.error,
      }),
    );

    await step.run("bump-counters", () =>
      bumpJobCounters({
        crawl_job_id,
        scraped: 1,
        qualified: result.ok && result.score.recommended_action === "qualified" ? 1 : 0,
        rejected: !result.ok || result.score.recommended_action !== "qualified" ? 1 : 0,
      }),
    );
    await step.run("maybe-complete", () => completeIfDone(crawl_job_id));

    return result;
  },
);
