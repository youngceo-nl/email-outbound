"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function addNote(lead_id: string, body: string) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");

  const trimmed = body.trim();
  if (!trimmed) return { error: "empty" };

  const admin = createAdminClient();
  await admin.from("lead_notes").insert({ lead_id, body: trimmed, created_by: user.id });
  revalidatePath(`/leads`);
  return { ok: true };
}
