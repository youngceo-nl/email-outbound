"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Campaign, CampaignStatus, CampaignStep } from "@/lib/types";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

export type CampaignWithStats = Campaign & {
  steps: CampaignStep[];
  assigned_count: number;
  sent_count: number;
  replied_count: number;
};

export async function listCampaigns(): Promise<CampaignWithStats[]> {
  await requireUser();
  const admin = createAdminClient();

  const { data: campaigns } = await admin
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  if (!campaigns?.length) return [];

  const ids = campaigns.map((c) => c.id);

  const [{ data: steps }, { data: leads }, { data: messages }] = await Promise.all([
    admin.from("campaign_steps").select("*").in("campaign_id", ids).order("step_number", { ascending: true }),
    admin.from("leads").select("campaign_id, reply_count").in("campaign_id", ids),
    admin.from("outreach_messages").select("campaign_id").in("campaign_id", ids).eq("status", "sent"),
  ]);

  const stepsByCampaign = new Map<string, CampaignStep[]>();
  for (const s of steps ?? []) {
    const arr = stepsByCampaign.get(s.campaign_id) ?? [];
    arr.push(s);
    stepsByCampaign.set(s.campaign_id, arr);
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
    steps: stepsByCampaign.get(c.id) ?? [],
    assigned_count: assignedByCampaign.get(c.id) ?? 0,
    sent_count: sentByCampaign.get(c.id) ?? 0,
    replied_count: repliedByCampaign.get(c.id) ?? 0,
  }));
}

export async function getCampaign(id: string): Promise<CampaignWithStats | null> {
  await requireUser();
  const admin = createAdminClient();

  const { data: campaign } = await admin.from("campaigns").select("*").eq("id", id).single();
  if (!campaign) return null;

  const [{ data: steps }, { count: assigned_count }, { count: sent_count }, { data: leads }] = await Promise.all([
    admin.from("campaign_steps").select("*").eq("campaign_id", id).order("step_number", { ascending: true }),
    admin.from("leads").select("id", { count: "exact", head: true }).eq("campaign_id", id),
    admin.from("outreach_messages").select("id", { count: "exact", head: true }).eq("campaign_id", id).eq("status", "sent"),
    admin.from("leads").select("reply_count").eq("campaign_id", id),
  ]);

  const replied_count = (leads ?? []).filter((l) => (l.reply_count ?? 0) > 0).length;

  return {
    ...campaign,
    steps: steps ?? [],
    assigned_count: assigned_count ?? 0,
    sent_count: sent_count ?? 0,
    replied_count,
  };
}

export async function getCampaignLeads(id: string) {
  await requireUser();
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("id, username, full_name, email, campaign_step, last_campaign_send_at, reply_count, status")
    .eq("campaign_id", id)
    .order("last_campaign_send_at", { ascending: false, nullsFirst: false });
  return data ?? [];
}

export async function createCampaign(name: string, angle: string | null): Promise<{ ok: boolean; id?: string; error?: string }> {
  await requireUser();
  const cleanName = name.trim();
  if (!cleanName) return { ok: false, error: "Name is required." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("campaigns")
    .insert({ name: cleanName, angle: angle?.trim() || null })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaigns");
  return { ok: true, id: data.id };
}

export async function updateCampaign(
  id: string,
  patch: { name?: string; angle?: string | null },
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

export type StepInput = {
  step_number: number;
  delay_days: number;
  subject_template: string;
  body_template: string;
};

// Replaces the full step list — simplest correct approach for a reorderable
// N-step sequence editor (delete-all-then-insert inside one call).
export async function upsertCampaignSteps(
  campaignId: string,
  steps: StepInput[],
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!steps.length) return { ok: false, error: "A campaign needs at least one step." };

  const admin = createAdminClient();

  const { error: delErr } = await admin.from("campaign_steps").delete().eq("campaign_id", campaignId);
  if (delErr) return { ok: false, error: delErr.message };

  const rows = steps.map((s, i) => ({
    campaign_id: campaignId,
    step_number: i + 1,
    delay_days: Math.max(0, Math.trunc(s.delay_days)),
    subject_template: s.subject_template.trim(),
    body_template: s.body_template.trim(),
  }));

  const { error: insErr } = await admin.from("campaign_steps").insert(rows);
  if (insErr) return { ok: false, error: insErr.message };

  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true };
}

// Bulk-assigns leads to a campaign (or clears assignment when campaignId is
// null). Re-assigning always restarts the sequence from step 1 — a lead
// moved into a different campaign shouldn't inherit progress from the old one.
export async function assignLeadsToCampaign(
  leadIds: string[],
  campaignId: string | null,
): Promise<{ ok: boolean; updated: number; error?: string }> {
  await requireUser();
  const clean = [...new Set((leadIds ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  if (clean.length === 0) return { ok: true, updated: 0 };

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("leads")
    .update(
      { campaign_id: campaignId, campaign_step: 0, last_campaign_send_at: null },
      { count: "exact" },
    )
    .in("id", clean);
  if (error) return { ok: false, updated: 0, error: error.message };

  revalidatePath("/leads");
  revalidatePath("/campaigns");
  if (campaignId) revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath("/outreach-ready");
  return { ok: true, updated: count ?? clean.length };
}
