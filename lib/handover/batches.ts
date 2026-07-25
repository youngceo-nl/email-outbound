import { createAdminClient } from "@/lib/supabase/admin";

// Where a batch lead ended up, reconstructed from its current row. Enriched
// leads keep handover_batch_id after a batch closes, so a closed batch can
// still account for every email-found / no-email lead it produced. Leads that
// were marked bad or returned to the pool lose the link (handover_batch_id
// nulled), so they can't appear here — those are surfaced per-account instead.
export type BatchDestination = "outreach_ready" | "contacted" | "no_email" | "pending";

export type BatchLead = {
  username: string;
  fullName: string | null;
  email: string | null;
  destination: BatchDestination;
};

export type BatchRecord = {
  id: string;
  parentUsername: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
  total: number;
  emailFound: number;
  noEmail: number;
  pending: number;
  leads: BatchLead[];
};

type LeadRow = {
  handover_batch_id: string;
  username: string;
  full_name: string | null;
  email: string | null;
  handover_enriched_at: string | null;
  status: string | null;
  outreach_count: number | null;
};

function destinationOf(lead: LeadRow): BatchDestination {
  if (lead.email) {
    // Mirrors the Outreach Ready page's eligibility: a valid email, not yet
    // contacted, still in a sendable status.
    const sendable = lead.status === "qualified" || lead.status === "review";
    const uncontacted = (lead.outreach_count ?? 0) === 0;
    return sendable && uncontacted ? "outreach_ready" : "contacted";
  }
  // No email: attempted (returned from Clay empty) vs still out with Clay.
  return lead.handover_enriched_at ? "no_email" : "pending";
}

/**
 * Every batch (open + closed), newest first, with a per-lead outcome
 * reconstructed from existing columns — the read model behind the Handover
 * page. No new tables: batch membership for enriched leads survives on
 * leads.handover_batch_id (see lib/handover/batch.ts), which is all this needs.
 */
export async function getBatchHistory(): Promise<BatchRecord[]> {
  const sb = createAdminClient();

  const { data: batches } = await sb
    .from("handover_batches")
    .select("id, parent_username, status, created_at, closed_at")
    .order("created_at", { ascending: false });

  if (!batches?.length) return [];

  const { data: leads } = await sb
    .from("leads")
    .select("handover_batch_id, username, full_name, email, handover_enriched_at, status, outreach_count")
    .in("handover_batch_id", batches.map((b) => b.id));

  const byBatch = new Map<string, LeadRow[]>();
  for (const lead of (leads ?? []) as LeadRow[]) {
    const list = byBatch.get(lead.handover_batch_id);
    if (list) list.push(lead);
    else byBatch.set(lead.handover_batch_id, [lead]);
  }

  return batches.map((batch) => {
    const rows = byBatch.get(batch.id) ?? [];
    const leadOutcomes: BatchLead[] = rows
      .map((r) => ({
        username: r.username,
        fullName: r.full_name,
        email: r.email,
        destination: destinationOf(r),
      }))
      .sort((a, b) => a.username.localeCompare(b.username));

    return {
      id: batch.id,
      parentUsername: batch.parent_username,
      status: batch.status,
      createdAt: batch.created_at,
      closedAt: batch.closed_at,
      total: leadOutcomes.length,
      emailFound: leadOutcomes.filter((l) => l.destination === "outreach_ready" || l.destination === "contacted").length,
      noEmail: leadOutcomes.filter((l) => l.destination === "no_email").length,
      pending: leadOutcomes.filter((l) => l.destination === "pending").length,
      leads: leadOutcomes,
    };
  });
}
