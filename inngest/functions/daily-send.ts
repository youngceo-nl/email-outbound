import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { gmailReady } from "@/lib/outreach/gmail";

const DAILY_SEND_TARGET = 25;
const INTERVAL_MINUTES = 20;

// Runs at 08:00 UTC (10:00 CEST) daily. Picks the top qualified leads
// with a confirmed email that haven't been contacted yet, ordered by score.
export const dailySend = inngest.createFunction(
  { id: "daily-send", name: "Daily outreach send" },
  { cron: "0 8 * * *" },
  async ({ step }) => {
    const ready = await step.run("check-gmail", () => gmailReady());
    if (!ready) return { skipped: "Gmail not connected" };

    const sb = createAdminClient();

    const leads = await step.run("pick-leads", async () => {
      const { data } = await sb
        .from("leads")
        .select("id")
        .in("status", ["qualified", "review"])
        .not("email", "is", null)
        .neq("email_status", "bounced")
        .eq("outreach_count", 0)
        .order("overall_score", { ascending: false })
        .limit(DAILY_SEND_TARGET);
      return data ?? [];
    });

    if (!leads.length) return { skipped: "no leads ready to send" };

    await step.sendEvent("queue-batch", {
      name: "outreach/batch.requested",
      data: {
        lead_ids: leads.map((l) => l.id),
        interval_minutes: INTERVAL_MINUTES,
      },
    });

    return { queued: leads.length, interval_minutes: INTERVAL_MINUTES };
  },
);
