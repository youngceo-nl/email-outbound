import { inngest } from "@/inngest/client";
import { scrapeProfiles } from "@/lib/apify/actors";
import { getSettings, resolveApifyTokens } from "@/lib/config/settings";
import { buildProfileAcquisitionEvents } from "@/lib/pipeline/canonical-events";
import { logCrawlBatch, logError } from "@/lib/pipeline/persist";
import {
  chunk,
  partitionByBioLink,
  PREFILTER_CHUNK,
  PREFILTER_REJECTION_REASON,
  type PrefilterLead,
} from "@/lib/pipeline/prefilter";
import { advanceRunLeads } from "@/lib/qualification/repository";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScrapedProfile } from "@/lib/types";

/**
 * Asks Apify about every lead in a run before Steel opens a single browser
 * session, and drops the ones with no bio link.
 *
 * This is an Inngest function rather than part of the start action because a
 * run can hold 500 leads and scrapeProfiles polls an actor on an 8s interval up
 * to a 600s ceiling (lib/apify/client.ts:63) — far too long to hold a server
 * action open. Chunking into separate steps means a batch that dies costs only
 * its own 50 leads, and Inngest retries it rather than the whole run.
 */
export const prefilterRun = inngest.createFunction(
  {
    id: "prefilter-run",
    name: "Pre-filter a run on bio links",
    retries: 1,
  },
  { event: "run/prefilter.requested" },
  async ({ event, step }) => {
    const { run_id, leads } = event.data;
    if (leads.length === 0) return { skipped: 0, acquiring: 0, prefiltered: false };

    const settings = await step.run("load-settings", () => getSettings(true));
    const tokens = resolveApifyTokens(settings);

    /*
     * No token is not a reason to stall a run. Steel is the path that actually
     * qualifies leads; the pre-filter only makes it cheaper, so its absence
     * degrades cost, never throughput.
     */
    if (tokens.length === 0) {
      await step.sendEvent(
        "request-acquisition",
        buildProfileAcquisitionEvents(leads, null, run_id),
      );
      return { skipped: 0, acquiring: leads.length, prefiltered: false };
    }

    const batches = chunk(leads, PREFILTER_CHUNK);
    const profiles: ScrapedProfile[] = [];

    for (const [i, batch] of batches.entries()) {
      /*
       * Swallowed on purpose. A batch that throws contributes no profiles, so
       * partitionByBioLink sees its usernames as unknown and sends them all to
       * Steel — the run gets more expensive, which is the correct way for this
       * to fail.
       */
      const found = await step.run(`fetch-profiles-${i}`, async () => {
        try {
          return await scrapeProfiles({
            token: tokens,
            usernames: batch.map((l) => l.username),
          });
        } catch (err) {
          await logError({
            context: "run-prefilter",
            error_message: `Apify batch ${i + 1}/${batches.length} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
            payload: { run_id, usernames: batch.map((l) => l.username) },
          });
          return [] as ScrapedProfile[];
        }
      });
      profiles.push(...found);
    }

    const { acquire, skipped } = partitionByBioLink(leads, profiles);

    if (skipped.length > 0) {
      await step.run("mark-skipped", () => markSkipped(run_id, skipped));
    }

    /*
     * event_index is assigned over the survivors, not the original list: it
     * drives the identity round-robin by modulo (canonical-events.ts:9), so
     * carrying the pre-filtered indices through would leave gaps and load the
     * surviving accounts unevenly.
     */
    if (acquire.length > 0) {
      await step.sendEvent(
        "request-acquisition",
        buildProfileAcquisitionEvents(acquire, null, run_id),
      );
    }

    return { skipped: skipped.length, acquiring: acquire.length, prefiltered: true };
  },
);

/**
 * Records the drop in three places: the run-lead row so the board can count it,
 * the lead row so a future sourced run does not re-pay Apify for the same
 * answer, and crawl_logs so it appears in the lead's own history.
 *
 * rejection_reason is the existing hardFilter vocabulary (lib/pipeline/filter.ts),
 * which is also what makes the whole bucket recoverable in one statement if the
 * policy ever changes.
 */
async function markSkipped(runId: string, skipped: PrefilterLead[]): Promise<void> {
  await advanceRunLeads({
    runId,
    usernames: skipped.map((l) => l.username),
    // Parked at the pre-filter slot rather than advanced: the chain ends here.
    stage: "prefilter",
    patch: {
      status: "skipped",
      acquisition_provider: "apify",
      error_message: null,
    },
  });

  /*
   * Chunked for the same reason as advanceRunLeads: a few hundred UUIDs in a
   * single `.in()` is a PostgREST URL long enough to be refused.
   */
  const sb = createAdminClient();
  for (const batch of chunk(skipped, 100)) {
    const { error } = await sb
      .from("leads")
      .update({
        status: "rejected",
        rejection_reason: PREFILTER_REJECTION_REASON,
        qualification_state: "done",
      })
      .in(
        "id",
        batch.map((l) => l.id),
      );
    if (error) throw new Error(`prefilter lead projection failed: ${error.message}`);
  }

  // Last, so a retry of a failed projection above cannot duplicate the history.
  await logCrawlBatch(
    skipped.map((lead) => ({
      crawl_job_id: null,
      profile_username: lead.username,
      parent_username: null,
      action: "prefilter_skipped",
      depth: 0,
      detail: "no bio link — nothing for the external-evidence crawl to read",
    })),
  );
}
