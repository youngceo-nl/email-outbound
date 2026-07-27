import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { rollVariant } from "@/lib/campaigns/due";

export type AssignResult = {
  ok: boolean;
  assigned: number;
  skipped: number;
  skippedReason?: string;
  error?: string;
};

// Auth-agnostic core of app/actions/campaigns.ts's assignLeadsToCampaign —
// extracted so the exact same assignment logic runs whether a human bulk-
// selects leads on the Leads page or the route-followup-leads Inngest job
// auto-assigns a lead into a cold/warm chain. No forked logic to keep in
// sync between the two callers.
//
// Bulk-assigns leads to a campaign (or clears assignment when campaignId is
// null). Hard-blocks on type mismatch: only leads whose lead_type matches the
// campaign's campaign_type are assigned; the rest are reported skipped, not
// silently dropped. Each matching lead is independently weighted-rolled into
// one of the campaign's variants and starts its sequence at step 0.
export async function assignLeadsToCampaignCore(
  admin: ReturnType<typeof createAdminClient>,
  leadIds: string[],
  campaignId: string | null,
): Promise<AssignResult> {
  const clean = [...new Set((leadIds ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  if (clean.length === 0) return { ok: true, assigned: 0, skipped: 0 };

  if (!campaignId) {
    const { error, count } = await admin
      .from("leads")
      .update(
        { campaign_id: null, campaign_variant_id: null, campaign_step: 0, last_campaign_send_at: null },
        { count: "exact" },
      )
      .in("id", clean);
    if (error) return { ok: false, assigned: 0, skipped: 0, error: error.message };
    return { ok: true, assigned: count ?? clean.length, skipped: 0 };
  }

  const [{ data: campaign }, { data: variants }, { data: leads }] = await Promise.all([
    admin.from("campaigns").select("campaign_type, deleted_at").eq("id", campaignId).single(),
    admin.from("campaign_variants").select("id, weight_pct").eq("campaign_id", campaignId),
    admin.from("leads").select("id, lead_type").in("id", clean),
  ]);
  if (!campaign) return { ok: false, assigned: 0, skipped: 0, error: "Campaign not found." };
  if (campaign.deleted_at) return { ok: false, assigned: 0, skipped: 0, error: "Campaign has been deleted." };
  if (!variants?.length) return { ok: false, assigned: 0, skipped: 0, error: "Campaign has no variants configured." };

  const matching = (leads ?? []).filter((l) => l.lead_type === campaign.campaign_type);
  const skipped = (leads ?? []).length - matching.length;

  for (const lead of matching) {
    const variant = rollVariant(variants as { id: string; weight_pct: number }[]);
    const { error } = await admin
      .from("leads")
      .update({
        campaign_id: campaignId,
        campaign_variant_id: variant.id,
        campaign_step: 0,
        last_campaign_send_at: null,
      })
      .eq("id", lead.id);
    if (error) return { ok: false, assigned: 0, skipped: 0, error: error.message };
  }

  return {
    ok: true,
    assigned: matching.length,
    skipped,
    skippedReason:
      skipped > 0
        ? `${skipped} lead${skipped === 1 ? "" : "s"} skipped — wrong track for this campaign's type.`
        : undefined,
  };
}
