"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, Loader2, Presentation } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RunButton } from "@/components/reports/run-button";
import { DeleteReportButton } from "@/components/reports/delete-button";

export type ReportListItem = {
  id: string;
  status: "queued" | "generating" | "ready" | "failed";
  /** Failure reason, or a note explaining a report that is ready without a PDF. */
  note: string | null;
  hasPdf: boolean;
  createdAt: string;
  createdBy: string | null;
  username: string;
  displayName: string | null;
};

export function ReportsList({ reports }: { reports: ReportListItem[] }) {
  const router = useRouter();
  /*
   * Only "generating" counts as in flight. "queued" is a resting state now that
   * nothing starts rows automatically — a row stranded in queued (an old Inngest
   * event that never arrived, say) would otherwise poll this page forever.
   */
  const inFlight = reports.some((r) => r.status === "generating");

  // Nothing pushes an update when a run finishes, so poll while one is running.
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [inFlight, router]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Generated reports</CardTitle>
        {inFlight && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> working…
          </span>
        )}
      </CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing generated yet. Pick a lead above, or open any lead and use the report panel to set the financial
            inputs first.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {reports.map((report) => (
              <div key={report.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={report.status} />
                    <Link href={`/leads/${report.username}`} className="font-medium hover:underline">
                      @{report.username}
                    </Link>
                    {report.displayName && (
                      <span className="truncate text-muted-foreground">{report.displayName}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(report.createdAt).toLocaleString()}
                    {report.createdBy ? ` · ${report.createdBy}` : ""}
                  </p>
                  {report.note && (
                    <p className={`mt-1 text-xs ${report.status === "failed" ? "text-red-600" : "text-amber-700"}`}>
                      {report.note}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  {report.status === "ready" ? (
                    <>
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/api/reports/${report.id}/deck`} target="_blank" rel="noreferrer">
                          <Presentation className="mr-1 h-3 w-3" /> Deck
                        </a>
                      </Button>
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
                      {/* Regenerating is a normal action: it picks up a price that
                          has since been scraped, or inputs someone has confirmed. */}
                      <RunButton reportId={report.id} label="Regenerate" />
                    </>
                  ) : (
                    /* queued, generating or failed. Nothing retries on its own now,
                       so this is the only way a stalled row moves. */
                    <RunButton reportId={report.id} label={report.status === "failed" ? "Retry" : "Run"} />
                  )}
                  <DeleteReportButton reportId={report.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ReportListItem["status"] }) {
  if (status === "ready") return <Badge>ready</Badge>;
  if (status === "failed") return <Badge variant="destructive">failed</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}
