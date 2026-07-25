import { NextResponse } from "next/server";
import { downloadPdf, getReport } from "@/lib/report/service";

/*
 * Streams the stored PDF.
 *
 * Proxied rather than redirecting to a Supabase signed URL: the bucket is private
 * because a report names a prospect and quotes their revenue, and a signed URL
 * that leaks (a pasted link, a referrer header) is valid for anyone holding it.
 * Going through the app means the session check in middleware.ts applies to every
 * download, and the file's location is never exposed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const report = await getReport(id);
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (report.status !== "ready" || !report.pdf_path) {
    return NextResponse.json({ error: "not_ready", status: report.status }, { status: 409 });
  }

  const pdf = await downloadPdf(report.pdf_path);
  if (!pdf) return NextResponse.json({ error: "file_missing" }, { status: 404 });

  const name = report.content_json?.metadata.username ?? "report";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // `inline` so it opens in the browser's viewer — the common case is
      // reviewing it before sending, not saving it to disk.
      "Content-Disposition": `inline; filename="${name}-webinar-strategy.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
