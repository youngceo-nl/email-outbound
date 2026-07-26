import { NextResponse } from "next/server";
import { getLeadForReport, getReport } from "@/lib/report/service";
import { buildReportHtml } from "@/lib/report/renderer/html";
import { fetchProspectImage } from "@/lib/report/renderer/prospect-image";

/*
 * The report as an HTML page, for reviewing before it goes out.
 *
 * Renders the *stored* content rather than rebuilding from the lead: a report is a
 * dated document, and a preview that quietly re-resolved assumptions against
 * newer scrape data would show something different from the PDF already attached
 * to an email.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = await getReport(id);
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!report.content_json) {
    return NextResponse.json({ error: "not_ready", status: report.status }, { status: 409 });
  }

  // The photo is not stored with the content (it would bloat every row), so it is
  // re-fetched here. A failure is expected and harmless — the cover falls back to
  // the monogram exactly as the PDF does.
  const lead = await getLeadForReport(report.lead_id);
  const photo = await fetchProspectImage(lead?.profile_pic_url);

  const html = await buildReportHtml(report.content_json, {
    prospectPhoto: photo.ok ? photo.image.dataUri : null,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
