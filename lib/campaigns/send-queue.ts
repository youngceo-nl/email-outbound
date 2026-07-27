import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/config/settings";
import { computeCampaignDue } from "@/lib/campaigns/due";
import { resolveReadyEmail } from "@/lib/outreach/ready-filter";
import { extractFirstName, extractFirstNameFromUsername } from "@/lib/outreach/template";
import { detectStepNeedsInput } from "@/lib/outreach/needs-input";
import type { CampaignStep } from "@/lib/types";
import type { OutreachRow } from "@/components/outreach/outreach-ready-client";

// Auth-agnostic core of app/actions/campaigns.ts's getCampaignSendQueue —
// extracted so the auto-send-followups Inngest job can enumerate due rows
// across every cold/warm chain using the exact same query/shape the human
// Send tab already renders, rather than a second, driftable copy of it.
//
// The embedded Send tab's data source: campaign leads with a valid email and
// an outstanding due step on their own (locked-in) variant.
export async function computeDueRowsForCampaign(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string,
): Promise<OutreachRow[]> {
  const { data: campaign } = await admin
    .from("campaigns")
    .select("name, deleted_at, campaign_role")
    .eq("id", campaignId)
    .single();
  if (!campaign || campaign.deleted_at) return [];
  const isWarm = campaign.campaign_role === "warm_followup";
  const isFollowup = campaign.campaign_role !== "primary";

  const { data: variants } = await admin.from("campaign_variants").select("id").eq("campaign_id", campaignId);
  const variantIds = (variants ?? []).map((v) => v.id);
  const { data: steps } = variantIds.length
    ? await admin.from("campaign_steps").select("*").in("variant_id", variantIds).order("step_number", { ascending: true })
    : { data: [] as CampaignStep[] };

  const stepsByVariant = new Map<string, CampaignStep[]>();
  for (const s of steps ?? []) {
    const arr = stepsByVariant.get(s.variant_id) ?? [];
    arr.push(s);
    stepsByVariant.set(s.variant_id, arr);
  }

  const { data: leads } = await admin
    .from("leads")
    .select(
      "id, username, full_name, niche, business_model, funnel_program_name, funnel_offer_summary, external_link, email, email_provider, email_status, email_v2, email_v2_provider, email_v2_status, overall_score, status, campaign_variant_id, campaign_step, last_campaign_send_at, reply_count",
    )
    .eq("campaign_id", campaignId)
    .in("status", ["qualified", "review"]);

  // Reply gate is role-aware, matching lib/outreach/send.ts's
  // sendOutreachEmailCore: a warm-followup chain exists *because* a lead
  // replied positively, so filtering out every lead with any reply (as
  // primary/cold_followup correctly do) would make its Send tab — and the
  // auto-send job that reuses this same query — permanently empty. Warm
  // chains only exclude a lead once a *negative* reply shows up.
  let negativeReplyLeadIds = new Set<string>();
  if (isWarm && leads?.length) {
    const { data: negRows } = await admin
      .from("inbox_messages")
      .select("lead_id")
      .eq("sentiment", "negative")
      .in("lead_id", leads.map((l) => l.id));
    negativeReplyLeadIds = new Set((negRows ?? []).map((r) => r.lead_id));
  }

  const settings = isFollowup ? await getSettings() : null;

  const rows: OutreachRow[] = [];
  for (const lead of leads ?? []) {
    if (isWarm ? negativeReplyLeadIds.has(lead.id) : (lead.reply_count ?? 0) > 0) continue;

    const resolved = resolveReadyEmail(lead);
    if (!resolved) continue;

    const variantSteps = lead.campaign_variant_id ? stepsByVariant.get(lead.campaign_variant_id) ?? [] : [];
    const due = computeCampaignDue(lead, variantSteps);
    if (!due) continue; // sequence complete, or variant has no steps configured yet

    const firstName = extractFirstName(lead.full_name) ?? extractFirstNameFromUsername(lead.username);

    // Only computed for cold/warm chains — this is what the auto-send job
    // uses to decide whether it can send without a human, and what the Send
    // tab shows as the "needs input" badge for exactly the rows it skips.
    const autoSendBlockedKeys = isFollowup
      ? detectStepNeedsInput({
          subjectTemplate: due.subjectTemplate,
          bodyTemplate: due.bodyTemplate,
          lead,
          senderName: settings?.gmail_from_name ?? null,
        }).missingKeys
      : undefined;

    rows.push({
      id: lead.id,
      username: lead.username,
      full_name: lead.full_name,
      niche: lead.niche,
      business_model: lead.business_model,
      funnel_program_name: lead.funnel_program_name,
      funnel_offer_summary: lead.funnel_offer_summary,
      external_link: lead.external_link,
      email: resolved.email,
      email_provider: resolved.provider,
      overall_score: lead.overall_score,
      status: lead.status,
      firstName,
      needsFix: !lead.funnel_program_name || firstName === null,
      autoSendBlockedKeys,
      parent_username: null,
      sourceOutcome: null,
      campaign: { id: campaignId, name: campaign.name, ...due },
    });
  }

  rows.sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0));
  return rows;
}
