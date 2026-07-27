"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOutreachEmailCore, type SendOutreachResponse } from "@/lib/outreach/send";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

export type SaveFieldsPatch = {
  full_name?: string | null;
  funnel_program_name?: string | null;
};

// The two fields automation gets wrong: full_name feeds {{first_name}} in the
// greeting, funnel_program_name feeds {{program_name}} in the subject line.
// Only keys actually present in `patch` are written, so saving one can never
// null the other.
export async function saveOutreachFields(
  leadId: string,
  patch: SaveFieldsPatch,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();

  const clean: Record<string, string | null> = {};
  for (const key of ["full_name", "funnel_program_name"] as const) {
    if (!(key in patch)) continue;
    const v = patch[key];
    clean[key] = typeof v === "string" ? v.trim() || null : null;
  }
  if (Object.keys(clean).length === 0) return { ok: true };

  const admin = createAdminClient();
  const { error } = await admin.from("leads").update(clean).eq("id", leadId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/outreach-ready");
  revalidatePath("/leads");
  return { ok: true };
}

// Thin auth+revalidation wrapper — the actual send/guard logic lives in
// lib/outreach/send.ts's sendOutreachEmailCore, shared with the
// auto-send-followups Inngest job so both callers run identical logic.
// Sends exactly the subject/body the client rendered and the user approved —
// no server-side re-render, so what was previewed is provably what ships.
export async function sendOutreachEmail(opts: {
  leadId: string;
  to: string;
  subject: string;
  body: string;
  // Required when the lead is campaign-assigned — the step being sent
  // (lead.campaign_step + 1). Non-campaign leads ignore this.
  campaignStepNumber?: number;
}): Promise<SendOutreachResponse> {
  const user = await requireUser();
  const admin = createAdminClient();
  const result = await sendOutreachEmailCore(admin, { ...opts, sentBy: user.id, sentVia: "manual" });

  revalidatePath("/outreach-ready");
  revalidatePath("/leads");
  return result;
}
