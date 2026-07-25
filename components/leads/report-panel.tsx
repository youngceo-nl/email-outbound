"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, AlertTriangle, Download, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { generateReportForLead, type PanelInput } from "@/app/actions/reports";
import { RunButton } from "@/components/reports/run-button";

/*
 * The Generate Report surface on a lead.
 *
 * The assumptions form is pre-filled from the cascade and collapsed by default:
 * the common path is "the scraped price is right, generate it", and making that
 * one click matters more than exposing ten inputs up front. Opening the form is
 * for the cases the panel itself flags.
 */

export type ReportSummary = {
  id: string;
  status: "queued" | "generating" | "ready" | "failed";
  error: string | null;
  /** False when the document is ready but no browser was available to print it. */
  hasPdf: boolean;
  createdAt: string;
  createdBy: string | null;
};

const TIER_STYLE: Record<string, string> = {
  human: "bg-foreground text-background",
  observed: "bg-emerald-100 text-emerald-900",
  researched: "bg-blue-100 text-blue-900",
  assumed: "bg-amber-100 text-amber-900",
};

const TIER_LABEL: Record<string, string> = {
  human: "confirmed",
  observed: "observed",
  researched: "benchmark",
  assumed: "assumption",
};

export function ReportPanel({
  leadId,
  inputs,
  warnings,
  reports,
}: {
  leadId: string;
  inputs: PanelInput[];
  warnings: string[];
  reports: ReportSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Only "generating" counts. Including "queued" here was a real trap: a row
   * stranded in queued would disable the Generate button permanently, so a single
   * stuck report would block the lead from ever getting another one.
   */
  const inFlight = reports.some((r) => r.status === "generating");

  // Nothing pushes an update when a run finishes, so poll while one is running.
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [inFlight, router]);

  const needsAttention = inputs.filter((input) => input.needsConfirmation);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const created = await generateReportForLead(leadId, formData);
      if (!created.ok) {
        setError(created.error);
        return;
      }
      setOpen(false);
      router.refresh();

      // Awaited so the serverless function survives the whole run; the row's own
      // status is the source of truth either way.
      const response = await fetch(`/api/reports/${created.reportId}/generate`, { method: "POST" });
      if (!response.ok && response.status !== 409) {
        const body = await response.json().catch(() => null);
        setError(body?.note ?? "Generation failed — see the report row below.");
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" /> Opportunity report
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide inputs" : "Review inputs"}
          </Button>
          <form action={submit}>
            <Button type="submit" size="sm" disabled={pending || inFlight}>
              {pending || inFlight ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {inFlight ? "Generating…" : "Generate report"}
            </Button>
          </form>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {warnings.map((warning, i) => (
          <div key={i} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{warning}</span>
          </div>
        ))}

        {/* Surfaced even when the form is closed: these are the inputs that will
            reach a prospect as assumptions if nobody looks at them. */}
        {!open && needsAttention.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {needsAttention.length} input{needsAttention.length === 1 ? "" : "s"} worth confirming:{" "}
            {needsAttention.map((i) => i.label.toLowerCase()).join(", ")}.
          </p>
        )}

        {open && (
          <form action={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {inputs.map((input) => (
                <label key={input.key} className="block space-y-1">
                  <span className="flex items-center gap-2 text-xs font-medium">
                    {input.label}
                    {input.isRate && <span className="text-muted-foreground">(%)</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${TIER_STYLE[input.tier] ?? ""}`}>
                      {TIER_LABEL[input.tier] ?? input.tier}
                    </span>
                  </span>
                  <input
                    name={input.key}
                    defaultValue={input.value}
                    inputMode="decimal"
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  />
                  <span className="block text-[11px] leading-snug text-muted-foreground">{input.source}</span>
                </label>
              ))}
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Generate with these inputs
            </Button>
          </form>
        )}

        {reports.length > 0 && (
          <div className="divide-y rounded-md border">
            {reports.map((report) => (
              <div key={report.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={report.status} />
                    <span className="text-muted-foreground">
                      {new Date(report.createdAt).toLocaleString()}
                      {report.createdBy ? ` · ${report.createdBy}` : ""}
                    </span>
                  </div>
                  {report.error && (
                    <p className={`mt-1 text-xs ${report.status === "failed" ? "text-red-600" : "text-amber-700"}`}>
                      {report.error}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {report.status === "ready" ? (
                    <>
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/api/reports/${report.id}/preview`} target="_blank" rel="noreferrer">
                          <Eye className="mr-1 h-3 w-3" /> Preview
                        </a>
                      </Button>
                      {report.hasPdf && (
                        <Button asChild variant="outline" size="sm">
                          <a href={`/api/reports/${report.id}/pdf`} target="_blank" rel="noreferrer">
                            <Download className="mr-1 h-3 w-3" /> PDF
                          </a>
                        </Button>
                      )}
                    </>
                  ) : (
                    <RunButton reportId={report.id} label={report.status === "failed" ? "Retry" : "Run"} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ReportSummary["status"] }) {
  if (status === "ready") return <Badge>ready</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}
