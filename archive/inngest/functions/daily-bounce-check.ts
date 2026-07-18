import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { gmailReady } from "@/lib/outreach/gmail";
import { gmailSearch, gmailGetMessage } from "@/lib/google/gmail-api";
import { logCrawl } from "@/lib/pipeline/persist";

// Runs at noon UTC (4 hours after the 08:00 daily send) so bounce NDRs have
// had time to arrive. Checks Gmail for mailer-daemon messages, marks matching
// outreach as bounced, and logs an alert in the activity feed if > 10% bounced.
export const dailyBounceCheck = inngest.createFunction(
  { id: "daily-bounce-check", name: "Daily bounce check" },
  { cron: "0 12 * * *" },
  async ({ step }) => {
    const ready = await step.run("check-gmail", () => gmailReady());
    if (!ready) return { skipped: "Gmail not connected" };

    const admin = createAdminClient();

    type SentRow = {
      id: string;
      lead_id: string;
      to_email: string;
      message_id: string;
      leads: { username: string }[] | null;
    };

    const sent = await step.run("load-sent", async () => {
      const { data } = await admin
        .from("outreach_messages")
        .select("id, lead_id, to_email, message_id, leads(username)")
        .eq("status", "sent")
        .not("message_id", "is", null)
        .order("sent_at", { ascending: false })
        .limit(200);
      return (data ?? []) as unknown as SentRow[];
    });

    if (!sent.length) return { skipped: "no sent messages to check" };

    const byMessageId = new Map<string, SentRow>(
      sent.filter((m) => m.message_id).map((m) => [m.message_id, m])
    );

    const ndrIds = await step.run("search-ndrs", () =>
      gmailSearch("from:(mailer-daemon OR postmaster) newer_than:90d", 100)
    );

    if (!ndrIds.length) return { bounced: 0, checked: 0 };

    // Process all NDRs in one step to avoid hundreds of Inngest steps for large inboxes
    const bounced = await step.run("process-ndrs", async () => {
      const now = new Date().toISOString();
      let count = 0;
      for (const ndrId of ndrIds) {
        const msg = await gmailGetMessage(ndrId);
        if (!msg?.inReplyTo) continue;
        const match = byMessageId.get(msg.inReplyTo.trim());
        if (!match) continue;

        await Promise.all([
          admin.from("outreach_messages").update({ status: "bounced", bounced_at: now }).eq("id", match.id),
          admin.from("leads").update({ email_status: "bounced" }).eq("id", match.lead_id),
        ]);

        const username = Array.isArray(match.leads)
          ? match.leads[0]?.username
          : (match.leads as unknown as { username: string } | null)?.username;

        await logCrawl({
          crawl_job_id: null,
          profile_username: username ?? match.lead_id,
          parent_username: null,
          action: "email_failed",
          depth: 0,
          status: "failure",
          detail: `Bounced: ${match.to_email}`,
        });

        count++;
      }
      return count;
    });

    // Alert if today's bounce rate > 10%
    if (bounced > 0) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const todaySent = await step.run("count-today-sent", async () => {
        const { count } = await admin
          .from("outreach_messages")
          .select("*", { count: "exact", head: true })
          .gte("sent_at", todayStart.toISOString());
        return count ?? 0;
      });

      const rate = todaySent > 0 ? bounced / todaySent : 0;
      if (rate > 0.1) {
        await step.run("log-bounce-alert", () =>
          logCrawl({
            crawl_job_id: null,
            profile_username: "system",
            parent_username: null,
            action: "email_failed",
            depth: 0,
            status: "failure",
            detail: `High bounce rate today: ${(rate * 100).toFixed(0)}% (${bounced}/${todaySent} sent)`,
          })
        );
      }
    }

    return { bounced, checked: ndrIds.length };
  },
);
