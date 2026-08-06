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
    // status is set explicitly (not just review_decision) so this also works for
    // the evidence-review queue, whose leads sit at status='rejected' until a
    // human approves them — a no-op overwrite for the legacy queue, which is
    // already 'qualified' by the time it reaches this action.
    .update({ status: "qualified", review_decision: "approved", reviewed_at: new Date().toISOString(), reviewed_by: user.id })
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

// ---------------------------------------------------------------------------
// Evidence-first review queue (docs/gaps.md gap 4 — minimal slice).
//
// The legacy queue above only ever shows status='qualified' leads. Leads the
// new lib/qualification/* pipeline marks decision='review' sit at whatever
// their legacy status already was (usually 'rejected', from the run that
// happened before reprocessing) — they never appear above. This is a second,
// parallel queue reading lead_qualification_decisions directly so those leads
// get a human verdict too, using the SAME review_decision/reviewed_by/reviewed_at
// columns (and the approveLead/rejectLead actions above) so they count toward
// the same audit trail and KPI, not a separate one.
// ---------------------------------------------------------------------------

export type EvidenceScoreComponent = {
  value: number;
  label: string;
  reason: string;
  citations: { phrase: string; source_type: string }[];
};

/*
 * Which scorer verdict the evidence queue shows.
 *
 * `review` is the operational queue: leads the pipeline could not decide, which
 * a human resolves so they can move on. `rejected` is not operational — it
 * exists to measure the scorer. Errors run in two directions, and only one of
 * them is visible anywhere else: a lead wrongly *qualified* surfaces in the
 * normal review tab before handover, but a lead wrongly *rejected* is simply
 * gone. On the 2026-08-04 run that was 28 of 39 leads, unexamined.
 *
 * See docs/KPI/scoring-targets.md — labelling both is what makes accuracy a
 * number rather than an opinion.
 */
export type EvidenceReviewDecision = "review" | "rejected";

export type EvidenceReviewLead = {
  id: string;
  decision_id: string;
  username: string;
  full_name: string | null;
  profile_url: string;
  bio: string | null;
  external_link: string | null;
  followers: number | null;
  track: string;
  certainty: string;
  commercial_fit: number | null;
  decision_reasons: string[];
  review_flags: string[];
  score_components: Record<string, EvidenceScoreComponent>;
};

// Supabase/PostgREST sends `.in()` filters as a query string; a few hundred
// UUIDs blows past the URL length limit and the fetch fails outright rather
// than erroring cleanly (confirmed: TypeError: fetch failed on ~575 ids).
// Chunk any lookup keyed on a large id list.
const IN_CLAUSE_BATCH_SIZE = 150;
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type DecisionRow = {
  id: string;
  lead_id: string | null;
  track: string;
  certainty: string;
  commercial_fit: number | null;
  decision_reasons: string[] | null;
  review_flags: string[] | null;
  payload: { score_components?: Record<string, EvidenceScoreComponent> } | null;
  created_at: string;
};

/**
 * Pulls a window of the most recent decision='review' rows, keeps only the
 * latest per lead (rows are already newest-first, so first-seen wins), then
 * drops any lead a human already ruled on. Good enough at current volume —
 * a real per-lead "latest" query (like getLatestQualificationBundle) would be
 * needed if this queue ever needs to scale past a few thousand rows.
 */
export async function getEvidenceReviewQueue(
  limit = 50,
  direction: "asc" | "desc" = "asc",
  decision: EvidenceReviewDecision = "review",
): Promise<EvidenceReviewLead[]> {
  await requireUser();
  const sb = createAdminClient();

  const { data: decisions } = await sb
    .from("lead_qualification_decisions")
    .select("id, lead_id, track, certainty, commercial_fit, decision_reasons, review_flags, payload, created_at")
    .eq("decision", decision)
    .order("created_at", { ascending: false })
    .limit(1000);

  const latestByLead = new Map<string, DecisionRow>();
  for (const d of (decisions ?? []) as DecisionRow[]) {
    if (!d.lead_id || latestByLead.has(d.lead_id)) continue;
    latestByLead.set(d.lead_id, d);
  }
  const leadIds = [...latestByLead.keys()];
  if (leadIds.length === 0) return [];

  const leadBatches = await Promise.all(
    chunk(leadIds, IN_CLAUSE_BATCH_SIZE).map((batch) =>
      sb
        .from("leads")
        .select("id, username, full_name, profile_url, bio, external_link, followers")
        .in("id", batch)
        .is("review_decision", null)
        .then((res) => res.data ?? []),
    ),
  );
  const leads = leadBatches.flat();

  const rows: EvidenceReviewLead[] = [];
  for (const lead of leads) {
    const d = latestByLead.get(lead.id);
    if (!d) continue;
    rows.push({
      id: lead.id,
      decision_id: d.id,
      username: lead.username,
      full_name: lead.full_name,
      profile_url: lead.profile_url,
      bio: lead.bio,
      external_link: lead.external_link,
      followers: lead.followers,
      track: d.track,
      certainty: d.certainty,
      commercial_fit: d.commercial_fit,
      decision_reasons: d.decision_reasons ?? [],
      review_flags: d.review_flags ?? [],
      score_components: d.payload?.score_components ?? {},
    });
  }

  rows.sort(
    (a, b) => ((a.commercial_fit ?? 0) - (b.commercial_fit ?? 0)) * (direction === "asc" ? 1 : -1),
  );
  return rows.slice(0, limit);
}

/** Drives the "Evidence Review" tab badge count. */
export async function getEvidenceReviewPendingCount(
  decision: EvidenceReviewDecision = "review",
): Promise<number> {
  await requireUser();
  const sb = createAdminClient();

  const { data: decisions } = await sb
    .from("lead_qualification_decisions")
    .select("lead_id")
    .eq("decision", decision)
    .order("created_at", { ascending: false })
    .limit(1000);
  const leadIds = [...new Set((decisions ?? []).map((d) => d.lead_id).filter((id): id is string => !!id))];
  if (leadIds.length === 0) return 0;

  const counts = await Promise.all(
    chunk(leadIds, IN_CLAUSE_BATCH_SIZE).map((batch) =>
      sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .in("id", batch)
        .is("review_decision", null)
        .then((res) => res.count ?? 0),
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}
