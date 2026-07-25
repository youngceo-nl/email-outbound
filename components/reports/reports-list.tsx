"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eye, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  const inFlight = reports.some((r) => r.status === "queued" || r.status === "generating");

  /*
   * Generation runs in a background job, so this page has no way to learn that it
   * finished. Polling only while something is actually in flight avoids leaving a
   * permanent timer running on an idle page.
   */
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

                {(report.status === "ready" || report.hasPdf) && (
                  <div className="flex shrink-0 gap-2">
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
                  </div>
                )}
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
