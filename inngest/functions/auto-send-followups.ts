import { inngest } from "@/inngest/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { computeDueRowsForCampaign } from "@/lib/campaigns/send-queue";
import { sendOutreachEmailCore } from "@/lib/outreach/send";
import { buildLeadContext, renderTemplate } from "@/lib/outreach/template";
import { gmailReady } from "@/lib/outreach/gmail";
import { logCrawl, logError } from "@/lib/pipeline/persist";

// Auto-sends due steps in the cold/warm follow-up chains
// (docs/instantly-fying-outreachpage/leadpipelinetocampaign.md) — the ONLY
// place in this app anything sends without a human click. Only ever
// considers campaigns with campaign_role <> 'primary' AND status = 'active';
// every follow-up chain starts life paused, so this job is a complete no-op
// until a chain is deliberately activated. Primary campaigns are completely
// unaffected — they keep today's fully-manual Send-tab flow.
//
// Per due (lead, step): if any placeholder the step's template actually uses
// doesn't resolve to something real for that lead (detectStepNeedsInput),
// it's left alone — it surfaces in that campaign's Send tab exactly like
// today, which *is* "the menu for those who need input". Otherwise it's sent
// through the same sendOutreachEmailCore the manual composer uses, so
// OUTREACH_DRY_RUN and every existing send guard apply identically.
export const autoSendFollowups = inngest.createFunction(
  {
    id: "auto-send-followups",
    name: "Auto-send due cold/warm follow-up steps",
    retries: 1, // a real send shouldn't be blindly retried by the framework — sendOutreachEmailCore's own guards are the backstop
    concurrency: [{ limit: 1 }],
  },
  { cron: "*/30 * * * *" }, // start slow — tighten later once observed working
  async ({ step }) => {
    const admin = createAdminClient();

    const gmailOk = await step.run("check-gmail", () => gmailReady());
    if (!gmailOk) return { skipped: "gmail_not_connected" };

    const chainIds = await step.run("load-active-chains", async () => {
      const { data } = await admin
        .from("campaigns")
        .select("id")
        .neq("campaign_role", "primary")
        .eq("status", "active")
        .is("deleted_at", null);
      return (data ?? []).map((c) => c.id);
    });

    if (!chainIds.length) return { skipped: "no_active_followup_chains", sent: 0, blocked: 0 };

    const settings = await step.run("load-settings", () => getSettings());

    let sent = 0;
    let blocked = 0;
    for (const campaignId of chainIds) {
      const rows = await step.run(`due-rows-${campaignId}`, () => computeDueRowsForCampaign(admin, campaignId));
      const due = rows.filter((r) => r.campaign?.isDue);

      for (const row of due) {
        await step.run(`send-${row.id}-step-${row.campaign!.stepNumber}`, async () => {
          // computeDueRowsForCampaign already ran detectStepNeedsInput for
          // every row on a non-primary campaign (all of these are) — reuse
          // it rather than recomputing, so the Send tab's "needs input"
          // badge and this gate can never drift apart.
          const missingKeys = row.autoSendBlockedKeys ?? [];
          if (missingKeys.length > 0) {
            blocked++;
            await logCrawl({
              crawl_job_id: null,
              profile_username: row.username,
              parent_username: null,
              action: "followup_needs_input",
              depth: 0,
              detail: `campaign ${campaignId} step ${row.campaign!.stepNumber}: missing ${missingKeys.join(",")}`,
            });
            return;
          }

          const ctx = buildLeadContext({ lead: row, senderName: settings.gmail_from_name });
          const subject = renderTemplate(row.campaign!.subjectTemplate, ctx);
          const body = renderTemplate(row.campaign!.bodyTemplate, ctx);

          try {
            const result = await sendOutreachEmailCore(admin, {
              leadId: row.id,
              to: row.email,
              subject,
              body,
              campaignStepNumber: row.campaign!.stepNumber,
              sentBy: null,
              sentVia: "auto",
            });
            if (result.ok) {
              sent++;
            } else {
              // Expected races (already sent, step advanced, lead replied since
              // this row was computed) — log, don't error.
              await logCrawl({
                crawl_job_id: null,
                profile_username: row.username,
                parent_username: null,
                action: "followup_auto_send_skipped",
                depth: 0,
                detail: `campaign ${campaignId} step ${row.campaign!.stepNumber}: ${result.error}`,
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await logError({
              context: "auto-send-followups",
              error_message: msg,
              payload: { lead_id: row.id, campaign_id: campaignId, step: row.campaign!.stepNumber },
            });
          }
        });
      }
    }

    return { sent, blocked };
  },
);
