"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveStatus } from "@/components/ui/live-status";
import { getRunSlots } from "@/app/actions/test-environment";
import { findJam, type Slot } from "@/lib/qualification/pipeline-stages";
import { cn } from "@/lib/utils";

const ACTIVE_POLL_MS = 2500;
const IDLE_POLL_MS = 10000;

/**
 * The run board: one column per real throttle or drop point in the pipeline.
 * Reading left to right shows where leads stopped moving, and the jam banner
 * names the slot rather than leaving it to be inferred from the numbers.
 */
export function SlotBoard({
  runId,
  initialSlots,
  running,
}: {
  runId: string;
  initialSlots: Slot[];
  running: boolean;
}) {
  const [slots, setSlots] = useState(initialSlots);
  const [live, setLive] = useState(running);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await getRunSlots(runId);
        if (!cancelled) setSlots(next);
      } catch {
        // A failed poll is not worth surfacing — the next one usually succeeds,
        // and the page still shows the last good state.
      }
    };
    const id = setInterval(tick, running ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [runId, live, running]);

  useEffect(() => setLive(running), [running]);

  const jam = findJam(slots);
  const maxEntered = Math.max(...slots.map((s) => s.entered), 1);

  return (
    <Card>
      <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Pipeline</CardTitle>
        {running && <LiveStatus active />}
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex overflow-x-auto">
          {slots.map((slot, i) => (
            <div
              key={slot.key}
              className={cn(
                "flex-1 min-w-[8.5rem] px-3 py-3",
                i > 0 && "border-l",
                slot.stuck > 0 && "bg-destructive/5",
              )}
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">
                {slot.label}
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-0.5">{slot.entered}</div>

              {/* Proportional bar makes a drop between columns visible at a glance. */}
              <div className="h-1 rounded-full bg-muted overflow-hidden mt-1.5 mb-2">
                <div
                  className="h-full bg-foreground/40"
                  style={{ width: `${(slot.entered / maxEntered) * 100}%` }}
                />
              </div>

              <div className="space-y-0.5 text-[11px] tabular-nums">
                {slot.active > 0 && <div className="text-foreground">{slot.active} here now</div>}
                {slot.stuck > 0 && (
                  <div className="text-destructive font-medium">{slot.stuck} stuck</div>
                )}
                {slot.failed > 0 && <div className="text-destructive">{slot.failed} failed</div>}
                {slot.blocked > 0 && (
                  // At the pre-filter every blocked lead is one we chose not to
                  // run, so name the reason rather than leave it to be inferred.
                  <div className="text-muted-foreground">
                    {slot.blocked} {slot.key === "prefilter" ? "skipped" : "blocked"}
                  </div>
                )}
                {slot.active === 0 && slot.stuck === 0 && slot.failed === 0 && slot.blocked === 0 && (
                  <div className="text-muted-foreground">—</div>
                )}
              </div>

              <div className="text-[10px] text-muted-foreground mt-2 leading-tight">{slot.note}</div>
            </div>
          ))}
        </div>

        {jam && (
          <div className="flex items-start gap-2 border-t px-4 py-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <span>
              <span className="font-medium">Jammed at {jam.slot.label}</span>
              <span className="text-muted-foreground"> — {jam.reason}. </span>
              <span className="text-muted-foreground text-xs">{jam.slot.note}</span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
