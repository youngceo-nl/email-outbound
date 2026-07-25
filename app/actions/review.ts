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

// Fields the focused review card needs to make an approve/reject call.
const REVIEW_FIELDS =
  "id, username, full_name, profile_url, bio, external_link, niche, business_model, followers, engagement_rate, posts_last_30_days, overall_score, reason_for_score";

export type ReviewLead = {
  id: string;
  username: string;
  full_name: string | null;
  profile_url: string;
  bio: string | null;
  external_link: string | null;
  niche: string | null;
  business_model: string | null;
  followers: number | null;
  engagement_rate: number | null;
  posts_last_30_days: number | null;
  overall_score: number | null;
  reason_for_score: string | null;
};

export type ReviewStats = {
  reviewed: number;
  approved: number;
  rejected: number;
  /** rejected / reviewed, 0..1. 0 when nothing reviewed yet. */
  badRate: number;
};

/**
 * The review queue: AI-qualified leads a human hasn't ruled on yet, *lowest*
 * score first — start from the bottom of the pile and work up, since the
 * borderline leads just over the qualification bar are where review actually
 * catches AI false positives; the top-scored ones are the obvious keeps.
 * `review_decision` is written only by the actions here, so the KPI reflects the
 * manual verdict alone.
 */
export type ReviewTrack = "infopreneur" | "partnership";

export async function getReviewQueue(
  limit = 50,
  direction: "asc" | "desc" = "asc",
  track: ReviewTrack = "infopreneur",
): Promise<ReviewLead[]> {
  await requireUser();
  const sb = createAdminClient();
  const { data } = await sb
    .from("leads")
    .select(REVIEW_FIELDS)
    .eq("status", "qualified")
    .eq("lead_type", track)
    .is("review_decision", null)
    // Skip leads that were already contacted (legacy: emailed before review
    // existed) — reviewing a lead that's past the handover decision is moot.
    .or("outreach_count.is.null,outreach_count.eq.0")
    // Deferred ("unsure") leads sort last in either direction: undeferred (null)
    // first, then by score. `direction` flips low↔high within the undeferred set.
    .order("review_deferred_at", { ascending: true, nullsFirst: true })
    .order("overall_score", { ascending: direction === "asc", nullsFirst: false })
    .limit(limit);
  return (data ?? []) as ReviewLead[];
}

/** Count of leads still awaiting review — drives the nav badge (both tracks). */
export async function getReviewPendingCount(): Promise<number> {
  await requireUser();
  const sb = createAdminClient();
  const { count } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("status", "qualified")
    .is("review_decision", null)
    .or("outreach_count.is.null,outreach_count.eq.0");
  return count ?? 0;
}

/** Pending-review counts per track — drives the Review page's tab counts. */
export async function getReviewTrackCounts(): Promise<Record<ReviewTrack, number>> {
  await requireUser();
  const sb = createAdminClient();
  const forTrack = (track: ReviewTrack) =>
    sb
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "qualified")
      .eq("lead_type", track)
      .is("review_decision", null)
      .or("outreach_count.is.null,outreach_count.eq.0");
  const [{ count: infopreneur }, { count: partnership }] = await Promise.all([
    forTrack("infopreneur"),
    forTrack("partnership"),
  ]);
  return { infopreneur: infopreneur ?? 0, partnership: partnership ?? 0 };
}

async function statsSince(since: string | null): Promise<ReviewStats> {
  const sb = createAdminClient();
  const { data } = await sb.rpc("review_stats", { p_since: since });
  const row = (data ?? [])[0] as { approved: number; rejected: number; reviewed: number } | undefined;
  const reviewed = Number(row?.reviewed ?? 0);
  const rejected = Number(row?.rejected ?? 0);
  return {
    reviewed,
    approved: Number(row?.approved ?? 0),
    rejected,
    badRate: reviewed > 0 ? rejected / reviewed : 0,
  };
}

/** All-time + last-7-day KPI, so recent tuning progress is visible next to the total. */
export async function getReviewStats(): Promise<{ allTime: ReviewStats; last7: ReviewStats }> {
  await requireUser();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [allTime, last7] = await Promise.all([statsSince(null), statsSince(sevenDaysAgo)]);
  return { allTime, last7 };
}

export async function approveLead(leadId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const sb = createAdminClient();
  const { error } = await sb
    .from("leads")
    .update({ review_decision: "approved", reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq("id", leadId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/review");
  revalidatePath("/leads");
  return { ok: true };
}

/**
 * "Unsure": defer the lead to the end of the queue without deciding it. Leaves
 * review_decision null (so it stays pending and out of the bad-lead KPI); the
 * timestamp sorts it last in getReviewQueue. Restamped each time so the most
 * recently deferred goes furthest back.
 */
export async function deferLead(leadId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const sb = createAdminClient();
  const { error } = await sb
    .from("leads")
    .update({ review_deferred_at: new Date().toISOString() })
    .eq("id", leadId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/review");
  return { ok: true };
}

/**
 * Reject during review: records the labeled negative in rejected_leads AND
 * stamps the review verdict, then drops the lead from handover. review_decision
 * is set here and nowhere else, so a later Clay-side rejection of an approved
 * lead can't retroactively count against the AI's qualification accuracy.
 *
 * The reason is free text (operator types why) — stored in `note` with
 * `category = 'uncategorized'`, a sentinel for a later system that reads the
 * note and assigns a canonical category.
 */
export async function rejectLead(
  leadId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();

  const sb = createAdminClient();
  const { data: lead, error: loadErr } = await sb
    .from("leads")
    .select("username, status")
    .eq("id", leadId)
    .single();
  if (loadErr || !lead) return { ok: false, error: loadErr?.message ?? "Lead not found" };

  const { error: upsertErr } = await sb.from("rejected_leads").upsert({
    lead_id: leadId,
    username: lead.username,
    category: "uncategorized",
    note: reason?.trim() || null,
    prior_status: lead.status,
    marked_by: user.id,
  });
  if (upsertErr) return { ok: false, error: upsertErr.message };

  const { error: updateErr } = await sb
    .from("leads")
    .update({
      review_decision: "rejected",
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      status: "rejected",
      handover_batch_id: null,
    })
    .eq("id", leadId);
  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePath("/review");
  revalidatePath("/leads");
  return { ok: true };
}

/**
 * Undo a review verdict (fast-queue misclick). Clears the decision; if it was a
 * reject, restores the lead to qualified and removes the rejected_leads row so
 * it re-enters the queue.
 */
export async function undoReview(leadId: string): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  const sb = createAdminClient();

  const { data: lead } = await sb.from("leads").select("review_decision").eq("id", leadId).single();

  const patch: Record<string, unknown> = { review_decision: null, reviewed_at: null, reviewed_by: null };
  if (lead?.review_decision === "rejected") {
    patch.status = "qualified";
    await sb.from("rejected_leads").delete().eq("lead_id", leadId);
  }

  const { error } = await sb.from("leads").update(patch).eq("id", leadId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/review");
  revalidatePath("/leads");
  return { ok: true };
}
