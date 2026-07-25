import { NextResponse } from "next/server";
import { runReport } from "@/lib/report/run";
import { getReport } from "@/lib/report/service";

/*
 * Runs generation for an already-created report row.
 *
 * The browser holds this request open, which is what makes it reliable on a
 * serverless platform: a fire-and-forget call from a server action can be frozen
 * the moment the action returns, whereas an in-flight client fetch keeps the
 * function alive until it answers.
 */

/*
 * Generation does an offer-page scrape, a model call and a PDF render, so it needs
 * far longer than a default request. 300s is the ceiling on Vercel's Pro plan; on
 * Hobby this is silently capped at 60s, which is usually still enough but can be
 * tight when the offer page is slow. A timeout leaves the row on "generating" and
 * clicking Generate again re-runs it — the scrape it already did is skipped.
 */
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await getReport(id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Guard against a double-click starting the work twice: the second call would
  // pay for a second model call and race the first on the same row.
  if (existing.status === "generating") {
    return NextResponse.json({ error: "already_running" }, { status: 409 });
  }

  const result = await runReport(id);
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}
