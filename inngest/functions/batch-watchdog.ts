import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramAlert } from "@/lib/telegram";

// send-outreach-batch / send-followup-batch drive themselves with step.sleep
// between sends, so a crashed *step* triggers onFailure — but if the whole
// run just stops advancing (Inngest dev server restarted, run got cancelled,
// deploy wiped in-flight state, etc.) nothing throws and no alert fires. This
// polls the same "X/Y" progress markers those functions already write into
// crawl_logs.detail and pages a Telegram alert if the most recent one is
// stale relative to the batch's own send interval.
const STALL_BUFFER_MINUTES = 10;
const INTERVAL_MINUTES = 20; // matches the default interval_minutes both batches use

type BatchCheck = {
  label: string;
  sentAction: string;
  failedAction: string;
  alertAction: string;
  progressRegex: RegExp;
};

const BATCHES: BatchCheck[] = [
  {
    label: "Follow-up batch",
    sentAction: "followup_sent",
    failedAction: "followup_failed",
    alertAction: "followup_stall_alert",
    progressRegex: /followup (\d+)\/(\d+)/,
  },
  {
    label: "Outreach batch",
    sentAction: "email_sent",
    failedAction: "email_failed",
    alertAction: "outreach_stall_alert",
    progressRegex: /batch (\d+)\/(\d+)/,
  },
];

export const batchWatchdog = inngest.createFunction(
  { id: "batch-watchdog", name: "Batch stall watchdog" },
  { cron: "*/15 * * * *" },
  async ({ step }) => {
    const admin = createAdminClient();
    const results: Record<string, string> = {};

    for (const batch of BATCHES) {
      results[batch.label] = await step.run(`check-${batch.alertAction}`, async () => {
        const { data: lastLog } = await admin
          .from("crawl_logs")
          .select("detail, created_at")
          .in("action", [batch.sentAction, batch.failedAction])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastLog?.detail) return "no activity";

        const match = lastLog.detail.match(batch.progressRegex);
        if (!match) return "no progress marker";

        const [, current, total] = match;
        if (Number(current) >= Number(total)) return "batch complete";

        const minutesSince = (Date.now() - new Date(lastLog.created_at).getTime()) / 60_000;
        if (minutesSince < INTERVAL_MINUTES + STALL_BUFFER_MINUTES) return "on schedule";

        const { data: lastAlert } = await admin
          .from("crawl_logs")
          .select("created_at")
          .eq("action", batch.alertAction)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastAlert && new Date(lastAlert.created_at) > new Date(lastLog.created_at)) {
          return "already alerted";
        }

        const delivered = await sendTelegramAlert(
          `🟡 ${batch.label} stalled: stuck at ${current}/${total}, no activity in ${Math.round(minutesSince)} min.`
        );

        // Only persist the dedup marker if Telegram actually accepted the
        // message — otherwise a delivery failure (e.g. chat not started yet)
        // would permanently suppress retries for this stall.
        if (!delivered) return "alert failed to deliver, will retry next run";

        await admin.from("crawl_logs").insert({
          crawl_job_id: null,
          profile_username: "system",
          parent_username: null,
          action: batch.alertAction,
          depth: 0,
          status: "failure",
          detail: `Stalled at ${current}/${total}, no activity in ${Math.round(minutesSince)} min.`,
        });

        return "alerted";
      });
    }

    return results;
  },
);
