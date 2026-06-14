"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

export type DeleteLeadsResult = { ok: boolean; deleted: number; error?: string };

// Bulk-delete leads by id. Before deleting, each lead's username is recorded in
// `excluded_usernames` so the crawler never re-adds it as a fresh duplicate.
export async function deleteLeads(ids: string[]): Promise<DeleteLeadsResult> {
  const user = await requireUser();
  const clean = [...new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0))];
  if (clean.length === 0) return { ok: true, deleted: 0 };

  const sb = createAdminClient();

  // 1. Look up usernames so we can remember them on the exclusion list.
  const { data: rows, error: selErr } = await sb
    .from("leads")
    .select("id, username")
    .in("id", clean);
  if (selErr) return { ok: false, deleted: 0, error: selErr.message };

  const usernames = (rows ?? [])
    .map((r) => r.username)
    .filter((u): u is string => !!u);

  // 2. Record them as excluded (idempotent — ignore ones already listed).
  if (usernames.length) {
    const excludeRows = usernames.map((u) => ({
      username: u.toLowerCase(),
      reason: "bulk_delete",
      excluded_by: user.id,
    }));
    const { error: exErr } = await sb
      .from("excluded_usernames")
      .upsert(excludeRows, { onConflict: "username", ignoreDuplicates: true });
    if (exErr) return { ok: false, deleted: 0, error: exErr.message };
  }

  // 3. Delete the leads (lead_notes + outreach_messages cascade on FK).
  const { error: delErr, count } = await sb
    .from("leads")
    .delete({ count: "exact" })
    .in("id", clean);
  if (delErr) return { ok: false, deleted: 0, error: delErr.message };

  revalidatePath("/leads");
  return { ok: true, deleted: count ?? clean.length };
}
