import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { crawlSeed } from "@/inngest/functions/crawl-seed";
import { processProfile } from "@/inngest/functions/process-profile";
import { recurseFollowing } from "@/inngest/functions/recurse-following";
import { enrichFunnel } from "@/inngest/functions/enrich-funnel";
import { enrichEmail } from "@/inngest/functions/enrich-email";
import { backfillMetadata } from "@/inngest/functions/backfill-metadata";
import { scoreLead } from "@/inngest/functions/score-lead";
import { refreshYtCookie } from "@/inngest/functions/refresh-yt-cookie";
import { refreshIgCookies } from "@/inngest/functions/refresh-ig-cookies";
import { sendOutreachBatch } from "@/inngest/functions/send-outreach-batch";
import { dailyScrape } from "@/inngest/functions/daily-scrape";
import { dailySend } from "@/inngest/functions/daily-send";
import { dailyBounceCheck } from "@/inngest/functions/daily-bounce-check";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [crawlSeed, processProfile, recurseFollowing, enrichFunnel, enrichEmail, backfillMetadata, scoreLead, refreshYtCookie, refreshIgCookies, sendOutreachBatch, dailyScrape, dailySend, dailyBounceCheck],
});
