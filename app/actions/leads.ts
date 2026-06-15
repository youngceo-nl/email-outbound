"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toUsername, profileUrl } from "@/lib/pipeline/normalize";
import { processLead } from "@/app/actions/process-lead";

async function requireUser() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

export type AddLeadResult = {
  ok: boolean;
  error?: string;
  username?: string;
  already_existed?: boolean;
  analyzing?: boolean;
};

// Add a single lead by hand from the Leads page. We only need a username; the
// rest of the profile is filled in by the normal analyze pipeline. When
// `analyze` is on (the default) we kick that pipeline off immediately so a bare
// username turns into a scored lead without a second click.
export async function addLead(formData: FormData): Promise<AddLeadResult> {
  await requireUser();

  const raw = String(formData.get("input") ?? "").trim();
  if (!raw) return { ok: false, error: "Enter an Instagram username or profile URL." };

  const username = toUsername(raw);
  if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) {
    return { ok: false, error: "That doesn't look like a valid Instagram username." };
  }

  const analyze = formData.get("analyze") === "on";
  const sb = createAdminClient();

  const { data: inserted, error } = await sb
    .from("leads")
    .insert({ username, profile_url: profileUrl(username), status: "pending", crawl_depth: 0 })
    .select("id")
    .single();

  if (error) {
    if (!/duplicate|unique/i.test(error.message)) return { ok: false, error: error.message };
    revalidatePath("/leads");
    return { ok: true, username, already_existed: true };
  }

  if (analyze && inserted?.id) {
    const res = await processLead(inserted.id as string);
    if (!res.ok) {
      // The lead is saved; only the analysis couldn't start. Don't fail the add.
      revalidatePath("/leads");
      return { ok: true, username, analyzing: false, error: `Added, but analysis couldn't start: ${res.error}` };
    }
  }

  revalidatePath("/leads");
  return { ok: true, username, analyzing: analyze };
}

// ─── CSV Import ──────────────────────────────────────────────────────────────

export type CsvImportRow = {
  username?: string;
  full_name?: string;
  email?: string;
  followers?: string;
  bio?: string;
  niche?: string;
  youtube_url?: string;
  linkedin_url?: string;
  profile_url?: string;
};

export type CsvImportResult = {
  ok: boolean;
  imported: number;
  skipped: number;
  error?: string;
};

const IG_PROFILE_RE = /instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?/;

function resolveUsername(row: CsvImportRow): string | null {
  // Direct username field first
  const direct = row.username?.trim().replace(/^@/, "").toLowerCase();
  if (direct && /^[a-z0-9._]{1,30}$/.test(direct)) return direct;
  // Derive from profile_url
  const fromUrl = row.profile_url?.match(IG_PROFILE_RE)?.[1]?.toLowerCase();
  if (fromUrl) return fromUrl;
  return null;
}

export async function importLeadsFromCsv(rows: CsvImportRow[]): Promise<CsvImportResult> {
  await requireUser();
  if (!rows.length) return { ok: true, imported: 0, skipped: 0 };

  const sb = createAdminClient();

  const inserts: object[] = [];
  let skipped = 0;

  for (const row of rows) {
    const username = resolveUsername(row);
    if (!username) { skipped++; continue; }

    const followers = row.followers ? parseInt(row.followers.replace(/[^0-9]/g, ""), 10) : null;

    inserts.push({
      username,
      profile_url: profileUrl(username),
      status: "pending",
      crawl_depth: 0,
      full_name: row.full_name?.trim() || null,
      email: row.email?.trim().toLowerCase() || null,
      email_status: row.email?.trim() ? "found" : null,
      followers: Number.isFinite(followers) ? followers : null,
      bio: row.bio?.trim() || null,
      niche: row.niche?.trim() || null,
      youtube_url: row.youtube_url?.trim() || null,
      linkedin_url: row.linkedin_url?.trim() || null,
    });
  }

  if (!inserts.length) return { ok: true, imported: 0, skipped };

  // ignoreDuplicates: silently skip rows whose username already exists.
  const { error } = await sb
    .from("leads")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .upsert(inserts as any[], { onConflict: "username", ignoreDuplicates: true });

  if (error) return { ok: false, imported: 0, skipped, error: error.message };

  revalidatePath("/leads");
  return { ok: true, imported: inserts.length, skipped };
}

// ─── Churn bucket actions ─────────────────────────────────────────────────────

export async function recordManualOutreach(leadId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const sb = createAdminClient();
  const { error } = await sb
    .from("leads")
    .update({ outreach_count: 1, last_outreach_at: new Date().toISOString() })
    .eq("id", leadId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/churn");
  return { ok: true };
}

export async function rejectLead(leadId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const sb = createAdminClient();
  const { error } = await sb
    .from("leads")
    .update({ status: "rejected", rejection_reason: "manual_reject_churn" })
    .eq("id", leadId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/churn");
  revalidatePath("/leads");
  return { ok: true };
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
