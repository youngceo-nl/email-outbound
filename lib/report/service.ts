// Guards the service-role key against ever reaching a client bundle. Note this
// specifier is not in node_modules — Next aliases it at build time — so this
// module can only be imported from Next-compiled code, never from a standalone
// tsx script. The render scripts deliberately go through build.ts instead.
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lead } from "@/lib/types";
import type { ReportOverrides } from "./assumptions/defaults";
import type { ReportContent, ScenarioSet } from "./schema";

/*
 * Persistence for generated reports.
 *
 * Reports are stored, not regenerated on demand. The document states figures as
 * observed on a date, so a prospect opening a link next week has to see the same
 * numbers that were approved — regenerating would re-resolve assumptions against
 * newer scrape data and quietly change what was already sent.
 */

const BUCKET = "reports";

export type ReportStatus = "queued" | "generating" | "ready" | "failed";

export type ReportRow = {
  id: string;
  lead_id: string;
  status: ReportStatus;
  content_json: ReportContent | null;
  inputs_json: unknown | null;
  scenarios_json: unknown | null;
  formula_version: string | null;
  overrides_json: ReportOverrides | null;
  confirmed_by: string | null;
  pdf_path: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function createReport(args: {
  leadId: string;
  overrides?: ReportOverrides;
  confirmedBy?: string | null;
  createdBy?: string | null;
}): Promise<ReportRow> {
  const sb = createAdminClient();
  const { data, error } = await sb
    .from("reports")
    .insert({
      lead_id: args.leadId,
      status: "queued",
      overrides_json: args.overrides ?? null,
      confirmed_by: args.confirmedBy ?? null,
      created_by: args.createdBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createReport failed: ${error.message}`);
  return data as ReportRow;
}

export async function getReport(id: string): Promise<ReportRow | null> {
  const sb = createAdminClient();
  const { data } = await sb.from("reports").select("*").eq("id", id).single();
  return (data as ReportRow) ?? null;
}

export async function listReportsForLead(leadId: string): Promise<ReportRow[]> {
  const sb = createAdminClient();
  const { data } = await sb
    .from("reports")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  return (data as ReportRow[]) ?? [];
}

/** The lead row a report was generated from, loaded fresh for regeneration. */
export async function getLeadForReport(leadId: string): Promise<Lead | null> {
  const sb = createAdminClient();
  const { data } = await sb.from("leads").select("*").eq("id", leadId).single();
  return (data as Lead) ?? null;
}

async function patch(id: string, values: Record<string, unknown>): Promise<void> {
  const sb = createAdminClient();
  const { error } = await sb
    .from("reports")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`report ${id} update failed: ${error.message}`);
}

export async function markGenerating(id: string): Promise<void> {
  await patch(id, { status: "generating", error: null });
}

export async function saveContent(
  id: string,
  args: { content: ReportContent; scenarios: ScenarioSet; inputs: unknown; formulaVersion: string },
): Promise<void> {
  await patch(id, {
    content_json: args.content,
    scenarios_json: args.scenarios,
    inputs_json: args.inputs,
    formula_version: args.formulaVersion,
  });
}

/**
 * `pdfPath` is null when the document rendered but no headless browser was
 * available to print it.
 *
 * That is a usable outcome, not a failure: the preview route serves the same HTML
 * and its stylesheet is already A4, so a human can produce the PDF with Ctrl+P.
 * Treating it as a failure would make the entire feature depend on a remote
 * browser endpoint being configured first, which is a poor trade for a document
 * that is finished and correct.
 */
export async function markReady(id: string, pdfPath: string | null, note?: string): Promise<void> {
  await patch(id, { status: "ready", pdf_path: pdfPath, error: note ?? null });
}

export async function markFailed(id: string, message: string): Promise<void> {
  // Truncated: a Playwright or Supabase stack trace can be enormous, and the
  // column exists to tell an operator what broke, not to archive the trace.
  await patch(id, { status: "failed", error: message.slice(0, 2000) });
}

/**
 * Deletes a report and its stored PDF.
 *
 * Storage first, best-effort: an orphaned file in a private bucket costs pennies
 * and is invisible, whereas a DB row pointing at a deleted file would render a
 * broken download button. Any status is deletable — a row stuck in "generating"
 * (a killed function, a timed-out run) has no other way out, and a run that
 * finishes after its row is gone just updates zero rows.
 */
export async function deleteReport(id: string): Promise<void> {
  const sb = createAdminClient();
  const report = await getReport(id);
  if (!report) return;

  if (report.pdf_path) {
    await sb.storage.from(BUCKET).remove([report.pdf_path]);
  }
  const { error } = await sb.from("reports").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete report ${id}: ${error.message}`);
}

// ── PDF storage ─────────────────────────────────────────────────────────────

export async function uploadPdf(reportId: string, pdf: Buffer): Promise<string> {
  const sb = createAdminClient();
  const path = `${reportId}.pdf`;
  const { error } = await sb.storage.from(BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    // Regeneration overwrites in place rather than accumulating orphaned files.
    upsert: true,
  });
  if (error) throw new Error(`PDF upload failed for report ${reportId}: ${error.message}`);
  return path;
}

/**
 * A short-lived signed URL for the stored PDF.
 *
 * The bucket is private because a report names a prospect and quotes their
 * revenue — it must never be reachable by guessing a path.
 */
export async function signedPdfUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const sb = createAdminClient();
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}

export async function downloadPdf(path: string): Promise<Buffer | null> {
  const sb = createAdminClient();
  const { data } = await sb.storage.from(BUCKET).download(path);
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}
