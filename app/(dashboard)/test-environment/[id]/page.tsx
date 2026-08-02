import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getQualificationRun,
  getRunSlots,
  listRunLeads,
  type RunLeadFilter,
} from "@/app/actions/test-environment";
import { SlotBoard } from "@/components/test-environment/slot-board";
import { runHealth } from "@/lib/qualification/pipeline-stages";
import { formatCostUsd } from "@/lib/qualification/pricing";
import { cn, scoreColor } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTERS: RunLeadFilter[] = ["all", "failed", "qualified", "review", "rejected", "data_retry"];
const FILTER_LABEL: Record<RunLeadFilter, string> = {
  all: "All",
  failed: "Failed",
  qualified: "Qualified",
  review: "Review",
  rejected: "Rejected",
  data_retry: "Data retry",
};

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const filter: RunLeadFilter = (FILTERS as string[]).includes(sp.filter ?? "")
    ? (sp.filter as RunLeadFilter)
    : "all";

  const run = await getQualificationRun(id);
  if (!run) notFound();

  const [leads, slots] = await Promise.all([
    listRunLeads(id, filter).catch(() => []),
    getRunSlots(id).catch(() => []),
  ]);
  const { health, failures } = runHealth(run);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link
          href="/test-environment"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to test runs
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">
          {run.label ?? `Run ${run.id.slice(0, 8)}`}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })} · {run.status} ·{" "}
          <span className="font-mono text-xs">{run.id}</span>
        </p>
      </div>

      {slots.length > 0 && (
        <SlotBoard runId={id} initialSlots={slots} running={run.status === "running"} />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Summary
            <Badge
              variant={
                health === "broken" ? "destructive" : health === "degraded" ? "outline" : "secondary"
              }
            >
              {health}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Stat label="Processed" value={`${run.processed_count} / ${run.requested_count}`} />
          <Stat label="Qualified" value={String(run.qualified_count)} />
          <Stat label="Review" value={String(run.review_count)} />
          <Stat label="Rejected" value={String(run.rejected_count)} />
          <Stat label="Failed" value={String(failures)} tone={failures > 0 ? "bad" : undefined} />
          <Stat
            label="Extraction tokens"
            value={`${run.extraction_input_tokens.toLocaleString()} in`}
            sub={run.extractor_model ?? undefined}
          />
          <Stat
            label="Challenger tokens"
            value={`${run.challenger_input_tokens.toLocaleString()} in`}
            sub={run.challenger_model ?? "not run"}
          />
          <Stat
            label="Estimated cost"
            value={formatCostUsd({
              usd: run.estimated_cost_usd,
              unpriced: run.estimated_cost_usd === null ? ["unknown model"] : [],
            })}
          />
        </CardContent>
      </Card>

      <div className="flex gap-1 flex-wrap">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/test-environment/${id}?filter=${f}`}
            className={cn(
              "px-2.5 py-1 rounded-md border text-xs transition-colors",
              f === filter ? "bg-accent font-medium" : "hover:bg-accent/50 text-muted-foreground",
            )}
          >
            {FILTER_LABEL[f]}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No leads match this filter.
            </p>
          ) : (
            <ul className="divide-y">
              {leads.map((lead) => {
                const broke =
                  lead.status !== "ok" || lead.extraction_ok === false;
                return (
                  <li key={lead.id}>
                    <Link
                      href={`/test-environment/${id}/leads/${lead.id}`}
                      className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors"
                    >
                      <span
                        className={cn(
                          "text-xs font-semibold tabular-nums rounded px-1.5 py-0.5 shrink-0",
                          scoreColor(lead.commercial_fit),
                        )}
                      >
                        {lead.commercial_fit ?? "–"}
                      </span>
                      <span className="font-medium truncate min-w-0 flex-1">@{lead.username}</span>
                      {broke ? (
                        <Badge variant="destructive" className="text-[10px] shrink-0">
                          {lead.status !== "ok" ? lead.status : lead.extraction_failure_reason ?? "failed"}
                        </Badge>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground shrink-0">{lead.track}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {lead.decision}
                          </Badge>
                        </>
                      )}
                      {lead.challenger_trigger && lead.challenger_trigger !== "none" && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          challenger: {lead.challenger_trigger}
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bad";
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={cn("text-lg font-semibold tabular-nums", tone === "bad" && "text-destructive")}
      >
        {value}
      </span>
      {sub && <span className="text-[11px] text-muted-foreground truncate">{sub}</span>}
    </div>
  );
}
