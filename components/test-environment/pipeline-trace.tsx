import { AlertCircle, Ban, CheckCircle2, CircleDashed, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Stage, StageState } from "@/lib/qualification/pipeline-stages";
import { cn } from "@/lib/utils";

/*
 * `blocked` is deliberately neutral, not red. A correctly-rejected agency is the
 * system working; painting it the same colour as a crashed extraction trains
 * people to stop reading red.
 */
const STATE_STYLE: Record<
  StageState,
  { icon: typeof CheckCircle2; badge: "default" | "secondary" | "destructive" | "outline"; text: string }
> = {
  ok: { icon: CheckCircle2, badge: "secondary", text: "text-green-600 dark:text-green-400" },
  degraded: { icon: TriangleAlert, badge: "outline", text: "text-yellow-600 dark:text-yellow-400" },
  failed: { icon: AlertCircle, badge: "destructive", text: "text-destructive" },
  blocked: { icon: Ban, badge: "secondary", text: "text-muted-foreground" },
  skipped: { icon: CircleDashed, badge: "outline", text: "text-muted-foreground" },
};

export function PipelineTrace({ stages }: { stages: Stage[] }) {
  return (
    <div className="space-y-3">
      {stages.map((stage) => {
        const style = STATE_STYLE[stage.state];
        const Icon = style.icon;
        return (
          <Card key={stage.key} className={cn(stage.state === "failed" && "border-destructive/50")}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", style.text)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{stage.title}</span>
                    <Badge variant={style.badge} className="text-[10px]">
                      {stage.state}
                    </Badge>
                    {!stage.recorded && (
                      <span className="text-[11px] text-muted-foreground">
                        not recorded for this run
                      </span>
                    )}
                  </div>
                  <p className={cn("text-sm mt-0.5", style.text)}>{stage.headline}</p>
                </div>
              </div>

              {stage.rows.length > 0 && (
                <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-1 text-xs pl-7">
                  {stage.rows.map((row, i) => (
                    <div key={`${row.label}-${i}`} className="contents">
                      <dt className="text-muted-foreground truncate">{row.label}</dt>
                      <dd
                        className={cn(
                          "min-w-0",
                          row.verbatim && "font-mono text-[11px] whitespace-pre-wrap break-all",
                          row.tone === "muted" && "text-muted-foreground",
                          row.tone === "bad" && "text-destructive",
                        )}
                      >
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
