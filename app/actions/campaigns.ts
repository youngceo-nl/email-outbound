"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Campaign, CampaignRole, CampaignStatus, CampaignStep, CampaignType, CampaignVariant } from "@/lib/types";
import { assignLeadsToCampaignCore, type AssignResult } from "@/lib/campaigns/assign";
import { computeDueRowsForCampaign } from "@/lib/campaigns/send-queue";
import { checkOverridePassword } from "@/lib/security/override-password";
import type { OutreachRow } from "@/components/outreach/outreach-ready-client";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

export type CampaignVariantWithSteps = CampaignVariant & { steps: CampaignStep[] };

export type CampaignWithStats = Campaign & {
  variants: CampaignVariantWithSteps[];
  assigned_count: number;
  sent_count: number;
  replied_count: number;
};

async function attachVariantsAndStats(
  admin: ReturnType<typeof createAdminClient>,
  campaigns: Campaign[],
): Promise<CampaignWithStats[]> {
  if (!campaigns.length) return [];
  const ids = campaigns.map((c) => c.id);

  const { data: variants } = await admin
    .from("campaign_variants")
    .select("*")
    .in("campaign_id", ids);
  const variantIds = (variants ?? []).map((v) => v.id);

  const [{ data: steps }, { data: leads }, { data: messages }] = await Promise.all([
    variantIds.length
      ? admin.from("campaign_steps").select("*").in("variant_id", variantIds).order("step_number", { ascending: true })
      : Promise.resolve({ data: [] as CampaignStep[] }),
    admin.from("leads").select("campaign_id, reply_count").in("campaign_id", ids),
    admin.from("outreach_messages").select("campaign_id").in("campaign_id", ids).eq("status", "sent"),
  ]);

  const stepsByVariant = new Map<string, CampaignStep[]>();
  for (const s of steps ?? []) {
    const arr = stepsByVariant.get(s.variant_id) ?? [];
    arr.push(s);
    stepsByVariant.set(s.variant_id, arr);
  }

  const variantsByCampaign = new Map<string, CampaignVariantWithSteps[]>();
  for (const v of variants ?? []) {
    const arr = variantsByCampaign.get(v.campaign_id) ?? [];
    arr.push({ ...v, steps: stepsByVariant.get(v.id) ?? [] });
    variantsByCampaign.set(v.campaign_id, arr);
  }

  const assignedByCampaign = new Map<string, number>();
  const repliedByCampaign = new Map<string, number>();
  for (const l of leads ?? []) {
    const id = l.campaign_id as string;
    assignedByCampaign.set(id, (assignedByCampaign.get(id) ?? 0) + 1);
    if ((l.reply_count ?? 0) > 0) repliedByCampaign.set(id, (repliedByCampaign.get(id) ?? 0) + 1);
  }

  const sentByCampaign = new Map<string, number>();
  for (const m of messages ?? []) {
    const id = m.campaign_id as string;
    sentByCampaign.set(id, (sentByCampaign.get(id) ?? 0) + 1);
  }

  return campaigns.map((c) => ({
    ...c,
    variants: variantsByCampaign.get(c.id) ?? [],
    assigned_count: assignedByCampaign.get(c.id) ?? 0,
    sent_count: sentByCampaign.get(c.id) ?? 0,
    replied_count: repliedByCampaign.get(c.id) ?? 0,
  }));
}

export async function listCampaigns(): Promise<CampaignWithStats[]> {
  await requireUser();
  const admin = createAdminClient();
  const { data: campaigns } = await admin
    .from("campaigns")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return attachVariantsAndStats(admin, campaigns ?? []);
}

export type DeletedCampaign = { id: string; name: string; campaign_type: CampaignType; deleted_at: string };

// Soft-deleted campaigns still restorable within CAMPAIGN_RETENTION_DAYS
// (lib/campaigns/retention.ts) — no variants/stats needed here, this only
// backs the "Recently deleted" restore list.
export async function listDeletedCampaigns(): Promise<DeletedCampaign[]> {
  await requireUser();
  const admin = createAdminClient();
  const { data } = await admin
    .from("campaigns")
    .select("id, name, campaign_type, deleted_at")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  return (data ?? []) as DeletedCampaign[];
}

export async function getCampaign(id: string): Promise<CampaignWithStats | null> {
  await requireUser();
  const admin = createAdminClient();
  const { data: campaign } = await admin.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) return null;
  const [withStats] = await attachVariantsAndStats(admin, [campaign]);
  return withStats;
}

export async function getCampaignLeads(id: string) {
  await requireUser();
  const admin = createAdminClient();
  const [{ data: leads }, { data: variants }] = await Promise.all([
    admin
      .from("leads")
      .select("id, username, full_name, email, campaign_variant_id, campaign_step, last_campaign_send_at, reply_count, status")
      .eq("campaign_id", id)
      .order("last_campaign_send_at", { ascending: false, nullsFirst: false }),
    admin.from("campaign_variants").select("id, label").eq("campaign_id", id),
  ]);
  const variantIds = (variants ?? []).map((v) => v.id);
  const { data: steps } = variantIds.length
    ? await admin.from("campaign_steps").select("variant_id").in("variant_id", variantIds)
    : { data: [] as { variant_id: string }[] };

  const labelByVariant = new Map((variants ?? []).map((v) => [v.id, v.label]));
  const stepCountByVariant = new Map<string, number>();
  for (const s of steps ?? []) stepCountByVariant.set(s.variant_id, (stepCountByVariant.get(s.variant_id) ?? 0) + 1);

  return (leads ?? []).map((l) => ({
    ...l,
    variant_label: l.campaign_variant_id ? labelByVariant.get(l.campaign_variant_id) ?? null : null,
    variant_step_count: l.campaign_variant_id ? stepCountByVariant.get(l.campaign_variant_id) ?? 0 : 0,
  }));
}

export async function createCampaign(
  name: string,
  angle: string | null,
  campaignType: CampaignType,
  campaignRole: CampaignRole = "primary",
): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireUser();
  const cleanName = name.trim();
  if (!cleanName) return { ok: false, error: "Name is required." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("campaigns")
    .insert({
      name: cleanName,
      angle: angle?.trim() || null,
      campaign_type: campaignType,
      campaign_role: campaignRole,
      // Follow-up chains start paused — nothing auto-sends until this is
      // deliberately flipped to active, once the whole pipeline is verified.
      // Primary campaigns keep the schema default ('active').
      ...(campaignRole !== "primary" ? { status: "paused" as CampaignStatus } : {}),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "This track already has an active cold/warm-followup campaign — pause or delete it first." };
    }
    return { ok: false, error: error.message };
  }

  // Every campaign starts with one variant at 100% — split-testing is opt-in
  // (add a second variant and adjust the slider), not required up front.
  const { error: variantErr } = await admin
    .from("campaign_variants")
    .insert({ campaign_id: data.id, label: "A", weight_pct: 100 });
  if (variantErr) return { ok: false, error: variantErr.message };

  revalidatePath("/campaigns");
  return { ok: true, id: data.id };
}

export async function updateCampaign(
  id: string,
  patch: { name?: string; angle?: string | null; positive_reply_template?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const admin = createAdminClient();

  const clean: Record<string, string | null> = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) return { ok: false, error: "Name is required." };
    clean.name = n;
  }
  if (patch.angle !== undefined) clean.angle = patch.angle?.trim() || null;
  if (patch.positive_reply_template !== undefined) {
    clean.positive_reply_template = patch.positive_reply_template?.trim() || null;
  }

  const { error } = await admin
    .from("campaigns")
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return { ok: true };
}

export async function setCampaignStatus(id: string, status: CampaignStatus): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const admin = createAdminClient();
  const { error } = await admin
    .from("campaigns")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return { ok: true };
}

// Soft-deletes a campaign: leads/messages keep their campaign_id/variant/step
// exactly as-is (nothing cascades or clears), it just drops out of listCampaigns
// and the assign dropdown. Kept for CAMPAIGN_RETENTION_DAYS so an accidental
// delete is recoverable via restoreCampaign, then swept for real by the
// purge-deleted-campaigns cron. Gated behind the same override password as
// re-scraping — one shared "are you sure" for costly, hard-to-undo clicks.
export async function deleteCampaign(
  id: string,
  overridePassword: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();

  const denied = checkOverridePassword(overridePassword, "delete this campaign");
  if (denied) return { ok: false, error: denied };

  const admin = createAdminClient();
  // `.is("deleted_at", null)` stops a double-click from resetting an
  // already-deleted row's timestamp (and its retention countdown).
  const { error } = await admin
    .from("campaigns")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/leads");
  revalidatePath("/outreach-ready");
  return { ok: true };
}

// Reverses deleteCampaign within the retention window. No password gate —
// undoing an accidental delete isn't itself a costly action.
export async function restoreCampaign(id: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const admin = createAdminClient();
  const { error } = await admin.from("campaigns").update({ deleted_at: null }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/leads");
  return { ok: true };
}

export type VariantInput = { id?: string; label: string; weight_pct: number };

// Add/remove/reweight a campaign's variants. Existing rows are matched by id
// and updated in place (so their steps survive an edit); rows without an id
// are new variants; existing rows not present in the new list are deleted
// (cascades their steps). Blocked once leads are assigned — reassigning a
// variant out from under an in-flight lead would silently break its sequence.
export async function upsertCampaignVariants(
  campaignId: string,
  variants: VariantInput[],
): Promise<{ ok: boolean; error?: string; ids?: string[] }> {
  await requireUser();
  if (!variants.length) return { ok: false, error: "A campaign needs at least one variant." };

  const totalWeight = variants.reduce((sum, v) => sum + v.weight_pct, 0);
  if (totalWeight !== 100) return { ok: false, error: `Variant weights must sum to 100 (currently ${totalWeight}).` };
  if (variants.some((v) => !v.label.trim())) return { ok: false, error: "Every variant needs a label." };

  const admin = createAdminClient();

  const { count: assignedCount } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  if ((assignedCount ?? 0) > 0) {
    return { ok: false, error: "Can't change variants after leads have been assigned to this campaign." };
  }

  const { data: existing } = await admin.from("campaign_variants").select("id").eq("campaign_id", campaignId);
  const existingIds = new Set((existing ?? []).map((v) => v.id));
  const keepIds = new Set(variants.filter((v) => v.id).map((v) => v.id!));
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length) {
    const { error } = await admin.from("campaign_variants").delete().in("id", toDelete);
    if (error) return { ok: false, error: error.message };
  }

  // Returned in the same order as `variants` so the client can splice real
  // ids back into its local state positionally — without this, a
  // newly-inserted variant's id never reaches the client, its React key never
  // changes, and its step editor stays stuck looking permanently unsaved.
  const ids: string[] = [];
  for (const v of variants) {
    if (v.id) {
      const { error } = await admin
        .from("campaign_variants")
        .update({ label: v.label.trim(), weight_pct: v.weight_pct })
        .eq("id", v.id);
      if (error) return { ok: false, error: error.message };
      ids.push(v.id);
    } else {
      const { data, error } = await admin
        .from("campaign_variants")
        .insert({ campaign_id: campaignId, label: v.label.trim(), weight_pct: v.weight_pct })
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      ids.push(data.id);
    }
  }

  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, ids };
}

export type StepInput = {
  step_number: number;
  delay_days: number;
  subject_template: string;
  body_template: string;
};

// Replaces one variant's full step list — simplest correct approach for a
// reorderable N-step sequence editor (delete-all-then-insert inside one call).
export async function upsertVariantSteps(
  variantId: string,
  steps: StepInput[],
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!steps.length) return { ok: false, error: "A variant needs at least one step." };

  const admin = createAdminClient();

  const { data: variant } = await admin.from("campaign_variants").select("campaign_id").eq("id", variantId).single();
  if (!variant) return { ok: false, error: "Variant not found." };

  const { error: delErr } = await admin.from("campaign_steps").delete().eq("variant_id", variantId);
  if (delErr) return { ok: false, error: delErr.message };

  const rows = steps.map((s, i) => ({
    variant_id: variantId,
    step_number: i + 1,
    delay_days: Math.max(0, Math.trunc(s.delay_days)),
    subject_template: s.subject_template.trim(),
    body_template: s.body_template.trim(),
  }));

  const { error: insErr } = await admin.from("campaign_steps").insert(rows);
  if (insErr) return { ok: false, error: insErr.message };

  revalidatePath(`/campaigns/${variant.campaign_id}`);
  return { ok: true };
}

// Thin auth+revalidation wrapper — the actual assignment logic lives in
// lib/campaigns/assign.ts's assignLeadsToCampaignCore, shared with the
// route-followup-leads Inngest job so both callers run identical logic.
export async function assignLeadsToCampaign(
  leadIds: string[],
  campaignId: string | null,
): Promise<AssignResult> {
  await requireUser();
  const admin = createAdminClient();
  const result = await assignLeadsToCampaignCore(admin, leadIds, campaignId);

  revalidatePath("/leads");
  revalidatePath("/campaigns");
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/outreach-ready");
  return result;
}

// Thin auth wrapper — the actual query lives in lib/campaigns/send-queue.ts's
// computeDueRowsForCampaign, shared with the auto-send-followups Inngest job.
export async function getCampaignSendQueue(campaignId: string): Promise<OutreachRow[]> {
  await requireUser();
  return computeDueRowsForCampaign(createAdminClient(), campaignId);
}
