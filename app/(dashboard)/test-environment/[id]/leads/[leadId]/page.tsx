import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRunLeadTrace } from "@/app/actions/test-environment";
import { deriveStages } from "@/lib/qualification/pipeline-stages";
import { formatCostUsd } from "@/lib/qualification/pricing";
import { PipelineTrace } from "@/components/test-environment/pipeline-trace";
import { cn, scoreColor } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RunLeadTracePage({
  params,
}: {
  params: Promise<{ id: string; leadId: string }>;
}) {
  const { id, leadId } = await params;
  const trace = await getRunLeadTrace(leadId);
  if (!trace) notFound();

  const { runLead, snapshot, extraction, decision } = trace;
  const stages = deriveStages({ runLead, snapshot, extraction, decision });

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <Link
          href={`/test-environment/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Back to run
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <span
            className={cn(
              "text-sm font-semibold tabular-nums rounded-md px-2 py-1",
              scoreColor(runLead.commercial_fit),
            )}
          >
            {runLead.commercial_fit ?? "–"}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">@{runLead.username}</h1>
          <a
            href={trace.profileUrl ?? `https://www.instagram.com/${runLead.username}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          {runLead.decision && (
            <Badge variant="outline" className="text-[10px]">
              {runLead.decision} / {runLead.mode}
            </Badge>
          )}
        </div>
        {trace.bio && (
          <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{trace.bio}</p>
        )}
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-6 text-xs">
          <Field label="Total time" value={runLead.total_ms === null ? "not recorded" : `${runLead.total_ms}ms`} />
          <Field
            label="Extraction"
            value={`${runLead.extraction_input_tokens ?? 0} in / ${runLead.extraction_output_tokens ?? 0} out`}
            sub={runLead.extraction_model ?? undefined}
          />
          <Field
            label="Challenger"
            value={
              runLead.challenger_input_tokens
                ? `${runLead.challenger_input_tokens} in / ${runLead.challenger_output_tokens ?? 0} out`
                : "not run"
            }
            sub={runLead.challenger_model ?? undefined}
          />
          <Field
            label="Cost"
            value={formatCostUsd({
              usd: runLead.estimated_cost_usd,
              unpriced: runLead.estimated_cost_usd === null ? ["unknown model"] : [],
            })}
          />
        </CardContent>
      </Card>

      <PipelineTrace stages={stages} />
    </div>
  );
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  );
}
