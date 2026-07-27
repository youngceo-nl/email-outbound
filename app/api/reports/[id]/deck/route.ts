import { NextResponse } from "next/server";
import { getLeadForReport, getReport } from "@/lib/report/service";
import { buildReportDeckHtml } from "@/lib/report/renderer/deck-html";
import { fetchProspectImage } from "@/lib/report/renderer/prospect-image";

/*
 * The report as a full-screen pitch deck — the view to screen-share on a Loom.
 * Renders the *stored* content, same as the preview: a deck that quietly
 * re-resolved data would drift from the PDF already sent.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = await getReport(id);
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!report.content_json) {
    return NextResponse.json({ error: "not_ready", status: report.status }, { status: 409 });
  }

  const lead = await getLeadForReport(report.lead_id);
  const photo = await fetchProspectImage(lead?.profile_pic_url);

  const html = await buildReportDeckHtml(report.content_json, {
    prospectPhoto: photo.ok ? photo.image.dataUri : null,
  });

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
