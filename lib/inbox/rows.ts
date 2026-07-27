import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { InboxRow } from "@/components/outreach/outreach-ready-client";

// Shared inbox query — pulled out of app/(dashboard)/outreach-ready/page.tsx
// so the Outreach Ready inbox, the Campaigns section's master inbox, and
// each campaign's own per-campaign inbox tab all read through one place,
// never three copies that can drift. `campaignId` scopes to one campaign's
// leads; omitted, every reply is returned (campaign-assigned or not) — the
// master-inbox and Outreach Ready case.
//
// Tags/templates are derived live from the lead's CURRENT
// campaign_id/campaign_variant_id, not snapshotted at reply time — if a lead
// is later reassigned, its past replies reflect the new assignment. Same
// caveat the campaign-name tag already had.
export async function getInboxRows(
  admin: ReturnType<typeof createAdminClient>,
  opts?: { campaignId?: string; limit?: number },
): Promise<InboxRow[]> {
  let leadIdFilter: string[] | null = null;
  if (opts?.campaignId) {
    const { data: campaignLeads } = await admin.from("leads").select("id").eq("campaign_id", opts.campaignId);
    leadIdFilter = (campaignLeads ?? []).map((l) => l.id);
    if (leadIdFilter.length === 0) return [];
  }

  let query = admin
    .from("inbox_messages")
    .select(
      "id, from_email, from_name, subject, snippet, body_text, received_at, is_read, sentiment, gmail_message_id, replied_at, lead_id, outreach_messages(sent_at, gmail_thread_id), leads(username, full_name, niche, business_model, funnel_program_name, funnel_offer_summary, external_link, campaign_id, campaign_variant_id, campaigns(name, positive_reply_template), campaign_variants(label))",
    )
    .order("received_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  if (leadIdFilter) query = query.in("lead_id", leadIdFilter);

  const { data: replies } = await query;

  return (replies ?? []).map((r) => {
    const lead = (Array.isArray(r.leads) ? r.leads[0] : r.leads) as
      | {
          username?: string;
          full_name?: string | null;
          niche?: string | null;
          business_model?: string | null;
          funnel_program_name?: string | null;
          funnel_offer_summary?: string | null;
          external_link?: string | null;
          campaigns?: { name?: string; positive_reply_template?: string | null } | { name?: string; positive_reply_template?: string | null }[] | null;
          campaign_variants?: { label?: string } | { label?: string }[] | null;
        }
      | null;
    const campaign = Array.isArray(lead?.campaigns) ? lead?.campaigns[0] : lead?.campaigns;
    const variant = Array.isArray(lead?.campaign_variants) ? lead?.campaign_variants[0] : lead?.campaign_variants;
    // The outreach this reply answers — null for a legacy/orphaned row whose
    // outreach_message_id didn't resolve (e.g. the original send was purged).
    const outreach = (Array.isArray(r.outreach_messages) ? r.outreach_messages[0] : r.outreach_messages) as
      | { sent_at?: string; gmail_thread_id?: string | null }
      | null;
    return {
      id: r.id,
      from_email: r.from_email,
      from_name: r.from_name,
      subject: r.subject,
      snippet: r.snippet,
      body_text: r.body_text,
      received_at: r.received_at,
      sent_at: outreach?.sent_at ?? null,
      is_read: r.is_read,
      sentiment: r.sentiment,
      gmail_message_id: r.gmail_message_id,
      gmail_thread_id: outreach?.gmail_thread_id ?? null,
      replied_at: r.replied_at,
      lead_id: r.lead_id,
      lead_username: lead?.username ?? null,
      lead_full_name: lead?.full_name ?? null,
      niche: lead?.niche ?? null,
      business_model: lead?.business_model ?? null,
      funnel_program_name: lead?.funnel_program_name ?? null,
      funnel_offer_summary: lead?.funnel_offer_summary ?? null,
      external_link: lead?.external_link ?? null,
      campaign_name: campaign?.name ?? null,
      campaign_variant_label: variant?.label ?? null,
      positive_reply_template: campaign?.positive_reply_template ?? null,
    };
  });
}
