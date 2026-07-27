import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { sendEmail, gmailReady } from "@/lib/outreach/gmail";
import { textToHtml } from "@/lib/outreach/template";
import { logCrawl } from "@/lib/pipeline/persist";

// Set OUTREACH_DRY_RUN=1 in .env.local to exercise the whole screen without
// sending a real email or writing any state. Every send is irreversible and
// permanently burns the lead, so this is the switch to develop against —
// shared by the manual composer and the auto-send-followups Inngest job.
export function dryRunEnabled() {
  return process.env.OUTREACH_DRY_RUN === "1";
}

export type SendOutreachResponse = {
  ok: boolean;
  message_id?: string;
  error?: string;
  dryRun?: boolean;
};

// Auth-agnostic core of app/actions/outreach-ready.ts's sendOutreachEmail —
// extracted so the manual composer and the auto-send-followups Inngest job
// run the exact same send/guard logic, never a forked copy of it.
//
// Sends exactly the subject/body the caller rendered — no server-side
// re-render, so what was previewed (or what auto-send computed) is provably
// what ships.
export async function sendOutreachEmailCore(
  admin: ReturnType<typeof createAdminClient>,
  opts: {
    leadId: string;
    to: string;
    subject: string;
    body: string;
    // Required when the lead is campaign-assigned — the step being sent
    // (lead.campaign_step + 1). Non-campaign leads ignore this.
    campaignStepNumber?: number;
    // Who's sending — a real user id from the manual composer, null from a
    // background auto-send.
    sentBy: string | null;
    sentVia: "manual" | "auto";
  },
): Promise<SendOutreachResponse> {
  const to = opts.to.trim();
  const subject = opts.subject.trim();
  const bodyText = opts.body.trim();

  if (!to.includes("@")) return { ok: false, error: "No valid recipient email." };
  if (!subject) return { ok: false, error: "Subject is empty." };
  if (!bodyText) return { ok: false, error: "Body is empty." };

  // Re-read from the DB rather than trusting the caller's state — this is
  // the guard that stops a stale tab (or an auto-send racing a manual send)
  // from sending twice.
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, username, outreach_count, campaign_id, campaign_step, reply_count")
    .eq("id", opts.leadId)
    .single();
  if (leadErr || !lead) return { ok: false, error: leadErr?.message ?? "Lead not found" };

  const campaignId = lead.campaign_id as string | null;
  const campaignStep = (lead.campaign_step as number | null) ?? 0;

  if (!campaignId) {
    // Non-campaign leads: unchanged — one send, ever.
    if ((lead.outreach_count ?? 0) > 0) return { ok: false, error: "Already sent to this lead." };
  } else {
    // Campaign leads: the guard is step-aware instead of count-aware, since a
    // campaign is allowed to send multiple times (its own sequence).
    const stepNumber = opts.campaignStepNumber;
    if (!stepNumber) return { ok: false, error: "Missing campaign step number." };
    if (stepNumber !== campaignStep + 1) {
      return { ok: false, error: "This lead's campaign step is out of date — reload and try again." };
    }

    // Reply gate is role-aware: a warm-followup chain exists *because* a lead
    // replied positively, so the usual "any reply stops the sequence" rule
    // would make the warm chain unsendable by definition. It only halts on a
    // negative reply there. Every other role (primary, cold_followup) keeps
    // today's unconditional "any reply stops it" behavior unchanged.
    const { data: campaign } = await admin.from("campaigns").select("campaign_role").eq("id", campaignId).single();
    if (campaign?.campaign_role === "warm_followup") {
      const { count: negativeReplies } = await admin
        .from("inbox_messages")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", opts.leadId)
        .eq("sentiment", "negative");
      if ((negativeReplies ?? 0) > 0) {
        return { ok: false, error: "Lead has replied negatively — sequence stopped." };
      }
    } else if (((lead as { reply_count?: number | null }).reply_count ?? 0) > 0) {
      return { ok: false, error: "Lead has replied — sequence stopped." };
    }

    const { data: existing } = await admin
      .from("outreach_messages")
      .select("id")
      .eq("lead_id", opts.leadId)
      .eq("campaign_id", campaignId)
      .eq("step_number", stepNumber)
      .maybeSingle();
    if (existing) return { ok: false, error: "This step was already sent." };

    const { data: maxStepRow } = await admin
      .from("campaign_steps")
      .select("step_number")
      .eq("campaign_id", campaignId)
      .order("step_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxStepRow && stepNumber > maxStepRow.step_number) {
      return { ok: false, error: "No more steps in this campaign." };
    }
  }

  // Bail before Gmail and before any write.
  if (dryRunEnabled()) return { ok: true, message_id: "dry-run", dryRun: true };

  if (!(await gmailReady())) {
    return { ok: false, error: "Gmail not connected — check the OAuth credentials in Settings." };
  }

  const settings = await getSettings();
  const bodyHtml = textToHtml(bodyText);

  try {
    const result = await sendEmail({
      to,
      subject,
      text: bodyText,
      html: bodyHtml,
      replyTo: settings.outreach_reply_to ?? undefined,
    });

    await admin.from("outreach_messages").insert({
      lead_id: opts.leadId,
      to_email: to,
      subject,
      body_text: bodyText,
      body_html: bodyHtml,
      status: "sent",
      message_id: result.messageId,
      gmail_thread_id: result.threadId,
      sent_by: opts.sentBy,
      sent_via: opts.sentVia,
      campaign_id: campaignId,
      step_number: campaignId ? opts.campaignStepNumber : null,
    });

    const now = new Date().toISOString();
    await admin
      .from("leads")
      .update({
        outreach_count: (lead.outreach_count ?? 0) + 1,
        last_outreach_at: now,
        last_outreach_error: null,
        ...(campaignId
          ? { campaign_step: campaignStep + 1, last_campaign_send_at: now }
          : {}),
      })
      .eq("id", opts.leadId);

    await logCrawl({
      crawl_job_id: null,
      profile_username: lead.username,
      parent_username: null,
      action: "email_sent",
      depth: 0,
      detail: `To: ${to} · Subject: ${subject} · via ${opts.sentVia}`,
    });

    return { ok: true, message_id: result.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin.from("outreach_messages").insert({
      lead_id: opts.leadId,
      to_email: to,
      subject,
      body_text: bodyText,
      body_html: bodyHtml,
      status: "failed",
      error: msg,
      sent_by: opts.sentBy,
      sent_via: opts.sentVia,
      campaign_id: campaignId,
      step_number: campaignId ? opts.campaignStepNumber : null,
    });
    await admin.from("leads").update({ last_outreach_error: msg }).eq("id", opts.leadId);

    await logCrawl({
      crawl_job_id: null,
      profile_username: lead.username,
      parent_username: null,
      action: "email_failed",
      depth: 0,
      status: "failure",
      detail: msg.slice(0, 200),
    });

    return { ok: false, error: msg };
  }
}
