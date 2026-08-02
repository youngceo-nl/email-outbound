import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { FlaskConical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPreflight, listQualificationRuns, listSeeds } from "@/app/actions/test-environment";
import { StartRun } from "@/components/test-environment/start-run";
import { runHealth } from "@/lib/qualification/pipeline-stages";
import { formatCostUsd } from "@/lib/qualification/pricing";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const HEALTH_LABEL = { broken: "Broken", degraded: "Degraded", healthy: "Healthy" } as const;

export default async function TestEnvironmentPage() {
  const [runs, preflight, seeds] = await Promise.all([
    listQualificationRuns(30).catch(() => []),
    getPreflight().catch(() => []),
    listSeeds().catch(() => []),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Test Environment</h1>
        <p className="text-sm text-muted-foreground">
          Every qualification test run, stage by stage. Open a run to see where the pipeline broke —
          a failed AI call and a genuinely weak profile look identical in the scores, so this
          separates them.
        </p>
      </div>

      {preflight.length > 0 && <StartRun preflight={preflight} seeds={seeds} />}

      {runs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <FlaskConical className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No test runs recorded yet.</p>
            <p className="text-xs mt-1">
              Start one above, or run the CLI with{" "}
              <code className="text-[11px]">--persist --run-label &quot;name&quot;</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {runs.map((run) => {
                const { health, failures, failureRate } = runHealth(run);
                const total =
                  run.qualified_count +
                  run.review_count +
                  run.rejected_count +
                  run.data_retry_count;
                const dominantFailure =
                  run.extraction_failed_count >= run.acquisition_failed_count
                    ? `${run.extraction_failed_count} extraction failures`
                    : `${run.acquisition_failed_count} acquisition failures`;

                return (
                  <li key={run.id} className="p-4 hover:bg-muted/30 transition-colors">
                    <Link href={`/test-environment/${run.id}`} className="block space-y-2">
                      <div className="flex items-start gap-3">
                        <Badge
                          variant={
                            health === "broken"
                              ? "destructive"
                              : health === "degraded"
                                ? "outline"
                                : "secondary"
                          }
                        >
                          {HEALTH_LABEL[health]}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">
                            {run.label ?? `Run ${run.id.slice(0, 8)}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                            {" · "}
                            {run.processed_count} of {run.requested_count} processed
                            {run.status !== "completed" && ` · ${run.status}`}
                            {failures > 0 && (
                              <span className="text-destructive">
                                {" · "}
                                {dominantFailure} ({Math.round(failureRate * 100)}%)
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground tabular-nums shrink-0">
                          <div>
                            {formatCostUsd({
                              usd: run.estimated_cost_usd,
                              unpriced: run.estimated_cost_usd === null ? ["unknown model"] : [],
                            })}
                          </div>
                          <div className="mt-0.5">
                            {run.challenger_ran_count > 0
                              ? `${run.challenger_ran_count} challenger call(s)`
                              : "no challenger"}
                          </div>
                        </div>
                      </div>

                      {/* Outcome bar — a mostly-red run is legible without opening it. */}
                      {total + failures > 0 && (
                        <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
                          <Segment count={run.qualified_count} total={total + failures} className="bg-green-500" />
                          <Segment count={run.review_count} total={total + failures} className="bg-yellow-500" />
                          <Segment count={run.rejected_count} total={total + failures} className="bg-muted-foreground/40" />
                          <Segment count={run.data_retry_count} total={total + failures} className="bg-orange-500" />
                          <Segment count={failures} total={total + failures} className="bg-destructive" />
                        </div>
                      )}

                      <div className="flex gap-4 text-[11px] text-muted-foreground tabular-nums">
                        <span>{run.qualified_count} qualified</span>
                        <span>{run.review_count} review</span>
                        <span>{run.rejected_count} rejected</span>
                        {run.data_retry_count > 0 && <span>{run.data_retry_count} data retry</span>}
                        {failures > 0 && <span className="text-destructive">{failures} failed</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Segment({ count, total, className }: { count: number; total: number; className: string }) {
  if (count <= 0) return null;
  return <div className={cn(className)} style={{ width: `${(count / total) * 100}%` }} />;
}
