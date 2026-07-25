import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";
import { ReportsList, type ReportListItem } from "@/components/reports/reports-list";
import { GenerateButton } from "@/components/reports/generate-button";

export const dynamic = "force-dynamic";

/*
 * Reports as a first-class section rather than a card buried on one lead.
 *
 * Two halves, because there are two jobs: see what has already been produced, and
 * start a new one. The picker is deliberately a search rather than a browsable
 * list — there are ~14k leads, so scrolling to find one is not a real workflow.
 */

const CANDIDATE_LIMIT = 15;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const sb = createAdminClient();

  /*
   * The reports table may not exist yet if the migration has not been applied.
   * `error` is deliberately ignored rather than thrown: a missing table should
   * leave this page empty and usable, not replace the whole section with a stack
   * trace. Same reasoning as listReportsForLead.
   */
  const { data: reportRows } = await sb
    .from("reports")
    .select("id, lead_id, status, error, pdf_path, created_at, created_by")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = reportRows ?? [];

  // One query for the leads behind those reports, rather than a join — the
  // Supabase client's embedded-resource syntax needs a declared FK relationship
  // and this is clearer to read besides.
  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  const { data: reportLeads } = leadIds.length
    ? await sb.from("leads").select("id, username, full_name, followers").in("id", leadIds)
    : { data: [] };
  const leadById = new Map((reportLeads ?? []).map((l) => [l.id, l]));

  const reports: ReportListItem[] = rows.map((row) => {
    const lead = leadById.get(row.lead_id);
    return {
      id: row.id,
      status: row.status,
      note: row.error,
      hasPdf: Boolean(row.pdf_path),
      createdAt: row.created_at,
      createdBy: row.created_by,
      username: lead?.username ?? "(deleted lead)",
      displayName: lead?.full_name ?? null,
    };
  });

  // Candidates: qualified leads, best-scored first. A lead with a report already
  // is still listed — regenerating after confirming a price is a normal action.
  let candidateQuery = sb
    .from("leads")
    .select("id, username, full_name, followers, niche, overall_score, funnel_price, funnel_platform")
    .eq("status", "qualified")
    .order("overall_score", { ascending: false, nullsFirst: false })
    .limit(CANDIDATE_LIMIT);

  if (query) {
    const safe = query.replace(/[%,]/g, "");
    candidateQuery = candidateQuery.or(
      `username.ilike.%${safe}%,full_name.ilike.%${safe}%,niche.ilike.%${safe}%`,
    );
  }
  const { data: candidates } = await candidateQuery;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileText className="h-5 w-5" /> Reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Branded webinar strategy documents built from a lead&apos;s own scraped data. Every figure is labelled with
          where it came from.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start a report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                name="q"
                defaultValue={query}
                placeholder="Search qualified leads by handle, name, or niche…"
                className="w-full rounded-md border bg-background py-2 pl-8 pr-3 text-sm"
              />
            </div>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          {(candidates ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {query ? `No qualified leads match “${query}”.` : "No qualified leads yet."}
            </p>
          ) : (
            <div className="divide-y rounded-md border">
              {(candidates ?? []).map((lead) => (
                <div key={lead.id} className="flex items-center justify-between gap-4 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/leads/${lead.username}`} className="font-medium hover:underline">
                        @{lead.username}
                      </Link>
                      {lead.overall_score != null && <Badge variant="secondary">{lead.overall_score}</Badge>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        lead.full_name,
                        lead.niche,
                        lead.followers ? `${formatNumber(lead.followers)} followers` : null,
                        // Shown because it is the single input that most changes
                        // the report: with a scraped price the economics are
                        // observed, without one they are an assumption.
                        lead.funnel_price
                          ? `${lead.funnel_price}${lead.funnel_platform ? ` on ${lead.funnel_platform}` : ""}`
                          : "no price found yet",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <GenerateButton leadId={lead.id} />
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Showing the {CANDIDATE_LIMIT} best-scored qualified leads. To adjust the financial inputs before
            generating, open the lead and use the report panel there.
          </p>
        </CardContent>
      </Card>

      <ReportsList reports={reports} />
    </div>
  );
}
