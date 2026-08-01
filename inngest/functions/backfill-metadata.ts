/*
 * Compatibility adapter for the old metadata-backfill event.
 *
 * The canonical production path owns all profile acquisition and qualification.
 * This handler resolves legacy username batches to lead IDs and fans out only
 * lead/profile-acquisition.requested events. It never calls Apify, Instagram,
 * Playwright, or an AI provider itself.
 */
import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildProfileAcquisitionEvents } from "@/lib/pipeline/canonical-events";
import { logCrawl } from "@/lib/pipeline/persist";

export const backfillMetadata = inngest.createFunction(
  {
    id: "backfill-metadata",
    name: "Queue canonical profile acquisition",
    retries: 2,
    concurrency: { limit: 1 },
  },
  { event: "leads/backfill.metadata.requested" },
  async ({ event, step }) => {
    const { usernames, crawl_job_id = null } = event.data;
    if (!usernames?.length) return { queued: 0, missing: 0 };

    const leads = await step.run("resolve-leads", async () => {
      const sb = createAdminClient();
      const { data, error } = await sb
        .from("leads")
        .select("id, username")
        .in("username", usernames);
      if (error) throw new Error(error.message);
      return (data ?? []) as Array<{ id: string; username: string }>;
    });

    const events = buildProfileAcquisitionEvents(leads, crawl_job_id);
    if (events.length > 0) await step.sendEvent("fan-out-profile-acquisition", events);

    await logCrawl({
      crawl_job_id,
      profile_username: `acquisition-adapter:${usernames.length}`,
      parent_username: null,
      action: "profile_acquisition_queued",
      depth: 0,
      status: "success",
      detail: `requested=${usernames.length} queued=${events.length} missing=${usernames.length - leads.length}`,
    });

    return { queued: events.length, missing: usernames.length - leads.length };
  },
);
