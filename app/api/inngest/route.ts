import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { crawlSeed } from "@/inngest/functions/crawl-seed";
import { processProfile } from "@/inngest/functions/process-profile";
import { recurseFollowing } from "@/inngest/functions/recurse-following";
import { backfillMetadata } from "@/inngest/functions/backfill-metadata";
import { scoreLead } from "@/inngest/functions/score-lead";
import { retryBlockedLeads } from "@/inngest/functions/retry-blocked-leads";
import { refreshIgCookies } from "@/inngest/functions/refresh-ig-cookies";
import { batchWatchdog } from "@/inngest/functions/batch-watchdog";
import { purgeDeletedCampaigns } from "@/inngest/functions/purge-deleted-campaigns";
import { routeFollowupLeads } from "@/inngest/functions/route-followup-leads";
import { autoSendFollowups } from "@/inngest/functions/auto-send-followups";
import { syncInboxScheduled } from "@/inngest/functions/sync-inbox-scheduled";
import { shadowQualify } from "@/inngest/functions/shadow-qualify";
import { acquireProfile } from "@/inngest/functions/acquire-profile";
import { prefilterRun } from "@/inngest/functions/prefilter-run";
import { qualifyLead } from "@/inngest/functions/qualify-lead";

// dailyScrape is intentionally NOT registered here, permanently. Accounts are
// scraped once and re-scraping takes the override password (lib/seeds/scraped.ts),
// so scheduled crawling has no role left — every scrape is a deliberate click.
// Do not add it back without revisiting that policy.
//
// routeFollowupLeads/autoSendFollowups/syncInboxScheduled (cold/warm
// follow-up chains, docs/instantly-fying-outreachpage/leadpipelinetocampaign.md)
// are registered but inert by default — every follow-up chain is created
// with status='paused', and both jobs only ever act on status='active'
// chains. Nothing auto-sends until a chain is deliberately flipped to active.
/*
 * Vercel kills a serverless function at 10s by default, and one Inngest step is
 * one HTTP request — so an acquisition step would be truncated mid-session.
 * Measured on the 2026-08-05 run: median 19.2s per lead, max 58.9s, and steps
 * reached 63s during the container degradation on 2026-08-03. Hobby's 60s
 * ceiling has no headroom against that; 300 is the Pro maximum and leaves room
 * for a slow profile without ever silently cutting a lead in half.
 *
 * This is not optional for a hosted deploy. Without it most leads die.
 */
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    crawlSeed,
    processProfile,
    recurseFollowing,
    backfillMetadata,
    scoreLead,
    retryBlockedLeads,
    refreshIgCookies,
    batchWatchdog,
    purgeDeletedCampaigns,
    routeFollowupLeads,
    autoSendFollowups,
    syncInboxScheduled,
    // Observational only. Records what the evidence-first pipeline would have
    // decided; writes nothing to public.leads. Inert until
    // shadow_qualification_enabled is turned on.
    shadowQualify,
    prefilterRun,
    acquireProfile,
    qualifyLead,
  ],
});
