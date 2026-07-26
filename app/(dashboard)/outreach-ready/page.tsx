import { Mail } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { isPlausible } from "@/lib/leads/email-extract";
import { extractFirstName, extractFirstNameFromUsername } from "@/lib/outreach/template";
import { Card, CardContent } from "@/components/ui/card";
import { OutreachReadyClient, type OutreachRow, type InboxRow } from "@/components/outreach/outreach-ready-client";
import type { CategoryTemplates } from "@/lib/leads/category";
import { getHandoverOutcomesByParent } from "@/lib/handover/outcomes";

export const dynamic = "force-dynamic";

const BAD_EMAIL_STATUS = /^(bounced|invalid)$/i;

const LEAD_SELECT =
  "id, username, full_name, niche, business_model, funnel_program_name, funnel_offer_summary, external_link, email, email_provider, email_status, email_v2, email_v2_provider, email_v2_status, overall_score, status, outreach_count, parent_username, campaign_id, campaign_step, last_campaign_send_at, reply_count";

export default async function OutreachReadyPage() {
  const sb = createAdminClient();
  const settings = await getSettings();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [{ data: leads }, { data: followupLeads }, { count: sentToday }, { data: replies }, handoverOutcomes] = await Promise.all([
    sb
      .from("leads")
      .select(LEAD_SELECT)
      .in("status", ["qualified", "review"])
      .or("outreach_count.is.null,outreach_count.eq.0")
      .order("overall_score", { ascending: false, nullsFirst: false }),
    // Campaign follow-ups: a lead that already sent its first campaign step
    // (outreach_count > 0) drops out of the query above forever, but a
    // multi-step campaign still owes it a follow-up — surface those here
    // instead of only ever showing a lead once.
    sb
      .from("leads")
      .select(LEAD_SELECT)
      .in("status", ["qualified", "review"])
      .not("campaign_id", "is", null)
      .gt("outreach_count", 0)
      .order("overall_score", { ascending: false, nullsFirst: false }),
    sb
      .from("outreach_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("sent_at", startOfToday.toISOString()),
    // Replies scope to a *different* set of leads than `rows` above — a lead
    // with outreach_count > 0 (i.e. contacted, so possibly replied) is
    // excluded from the ready-to-send query, so business_model has to be
    // joined here independently rather than reused from `rows`.
    sb
      .from("inbox_messages")
      .select("id, from_email, from_name, subject, snippet, body_text, received_at, is_read, lead_id, leads(username, full_name, business_model)")
      .order("received_at", { ascending: false })
      .limit(200),
    getHandoverOutcomesByParent(),
  ]);

  // Campaign step lookup for both the "never contacted" leads (which may
  // already be step-1 campaign-assigned) and the follow-up candidates above.
  const campaignIds = [
    ...new Set(
      [...(leads ?? []), ...(followupLeads ?? [])]
        .map((l) => l.campaign_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const [{ data: campaignRows }, { data: campaignStepRows }] = campaignIds.length
    ? await Promise.all([
        sb.from("campaigns").select("id, name").in("id", campaignIds),
        sb.from("campaign_steps").select("*").in("campaign_id", campaignIds).order("step_number", { ascending: true }),
      ])
    : [{ data: [] }, { data: [] }];

  const campaignNameById = new Map((campaignRows ?? []).map((c) => [c.id, c.name]));
  const stepsByCampaign = new Map<string, typeof campaignStepRows>();
  for (const s of campaignStepRows ?? []) {
    const arr = stepsByCampaign.get(s.campaign_id) ?? [];
    arr.push(s);
    stepsByCampaign.set(s.campaign_id, arr);
  }

  function buildCampaignInfo(lead: {
    campaign_id: string | null;
    campaign_step: number | null;
    last_campaign_send_at: string | null;
  }): OutreachRow["campaign"] {
    if (!lead.campaign_id) return null;
    const steps = stepsByCampaign.get(lead.campaign_id) ?? [];
    const totalSteps = steps.length;
    const nextStepNumber = (lead.campaign_step ?? 0) + 1;
    if (nextStepNumber > totalSteps) return null; // sequence complete
    const step = steps.find((s) => s.step_number === nextStepNumber);
    if (!step) return null;

    let isDue = true;
    let dueAt: string | null = null;
    if ((lead.campaign_step ?? 0) > 0 && lead.last_campaign_send_at) {
      const due = new Date(lead.last_campaign_send_at);
      due.setDate(due.getDate() + step.delay_days);
      dueAt = due.toISOString();
      isDue = Date.now() >= due.getTime();
    }

    return {
      id: lead.campaign_id,
      name: campaignNameById.get(lead.campaign_id) ?? "Campaign",
      stepNumber: nextStepNumber,
      totalSteps,
      isDue,
      dueAt,
      subjectTemplate: step.subject_template,
      bodyTemplate: step.body_template,
    };
  }

  const inboxRows: InboxRow[] = (replies ?? []).map((r) => {
    const lead = (Array.isArray(r.leads) ? r.leads[0] : r.leads) as
      { username?: string; full_name?: string | null; business_model?: string | null } | null;
    return {
      id: r.id,
      from_email: r.from_email,
      from_name: r.from_name,
      subject: r.subject,
      snippet: r.snippet,
      body_text: r.body_text,
      received_at: r.received_at,
      is_read: r.is_read,
      lead_id: r.lead_id,
      lead_username: lead?.username ?? null,
      lead_full_name: lead?.full_name ?? null,
      business_model: lead?.business_model ?? null,
    };
  });

  // Same bucketing the archived batch page used, minus its first-name hard
  // block — this screen exists precisely so a bad name can be fixed inline.
  const rows: OutreachRow[] = [];
  for (const lead of [...(leads ?? []), ...(followupLeads ?? [])]) {
    if (BAD_EMAIL_STATUS.test(lead.email_status ?? "")) continue;

    const resolved = lead.email ?? lead.email_v2;
    if (!resolved || !isPlausible(resolved)) continue;
    // Fell back to v2 — apply v2's own status check.
    if (!lead.email && BAD_EMAIL_STATUS.test(lead.email_v2_status ?? "")) continue;

    // Follow-up candidates: stop once the lead has replied, or once its
    // sequence is already exhausted (buildCampaignInfo returns null for both
    // — a completed sequence and a replied lead have nothing left to send).
    const campaign = (lead.reply_count ?? 0) > 0 ? null : buildCampaignInfo(lead);
    if ((lead.outreach_count ?? 0) > 0 && !campaign) continue; // already-contacted, no follow-up owed

    const firstName =
      extractFirstName(lead.full_name) ?? extractFirstNameFromUsername(lead.username);

    rows.push({
      id: lead.id,
      username: lead.username,
      full_name: lead.full_name,
      niche: lead.niche,
      business_model: lead.business_model,
      funnel_program_name: lead.funnel_program_name,
      funnel_offer_summary: lead.funnel_offer_summary,
      external_link: lead.external_link,
      email: resolved,
      email_provider: (lead.email ? lead.email_provider : lead.email_v2_provider) ?? null,
      overall_score: lead.overall_score,
      status: lead.status,
      firstName,
      needsFix: !lead.funnel_program_name || firstName === null,
      parent_username: lead.parent_username,
      sourceOutcome: lead.parent_username ? handoverOutcomes.get(lead.parent_username) ?? null : null,
      campaign,
    });
  }

  // Leads whose email is currently broken sort first — they're the ones this
  // screen is for. Score breaks ties.
  rows.sort((a, b) => {
    if (a.needsFix !== b.needsFix) return a.needsFix ? -1 : 1;
    return (b.overall_score ?? 0) - (a.overall_score ?? 0);
  });

  if (rows.length === 0 && inboxRows.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight mb-4">Outreach Ready</h1>
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <Mail className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No leads are ready for outreach.</p>
            <p className="text-xs mt-1">
              A lead qualifies here once it has a valid, unbounced email and hasn&apos;t been contacted.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const templates: CategoryTemplates = {
    partnerships: { subject: settings.outreach_subject_partnerships, body: settings.outreach_body_partnerships },
    info: { subject: settings.outreach_subject_info, body: settings.outreach_body_info },
    other: { subject: settings.outreach_subject_other, body: settings.outreach_body_other },
  };

  return (
    <OutreachReadyClient
      rows={rows}
      inboxRows={inboxRows}
      templates={templates}
      senderName={settings.gmail_from_name}
      sentToday={sentToday ?? 0}
      dryRun={process.env.OUTREACH_DRY_RUN === "1"}
    />
  );
}
