import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { ReportDocument } from "./ReportDocument";
import { fontFaceCss, logos } from "./fonts";
import type { ReportContent } from "../schema";

/**
 * The report as a single self-contained HTML document: markup, stylesheet and
 * font bytes all inlined, nothing fetched at render time.
 *
 * Shared by the PDF job, the preview route and the local render scripts, so all
 * three are guaranteed to be looking at the same document. If they each built
 * their own HTML the PDF could drift from the on-screen preview, which is exactly
 * the bug that would be hardest to notice.
 *
 * Async because `react-dom/server` is imported dynamically: Next's App Router
 * rejects a static import of it anywhere in a route's module graph, and a dynamic
 * import also keeps it out of any bundle that never renders a report.
 */
export async function buildReportHtml(
  content: ReportContent,
  opts?: { prospectPhoto?: string | null },
): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");

  const assets = { logoMark: logos().mark, prospectPhoto: opts?.prospectPhoto ?? null };
  const body = renderToStaticMarkup(createElement(ReportDocument, { content, assets }));
  const css = readFileSync(join(process.cwd(), "lib", "report", "renderer", "document.css"), "utf8");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${content.metadata.reportTitle} — ${content.metadata.displayName}</title>
<style>${fontFaceCss()}</style>
<style>${css}</style>
</head><body>${body}</body></html>`;
}
