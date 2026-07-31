"use client";
import { useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";

export type PipelineStep = {
  key: string;
  label: string;
  /** null = not tracked yet (no fabricated number, no drop math against it). */
  value: number | null;
  /** Pre-rendered icon element — a server component can't pass a component
   *  reference (e.g. a lucide-react icon) across to a client component,
   *  only serializable data and already-rendered elements. */
  icon: ReactNode;
};

const VIEW_W = 1200;
const VIEW_H = 220;
const CENTER_Y = VIEW_H / 2;
const MAX_BAND_H = 160;
const MIN_BAND_H = 6;

// Smooth tapering "flow" ribbon across stage values (a simplified Sankey),
// tolerant of values rising between stages — this isn't a strictly
// narrowing funnel (e.g. cumulative "Emails Sent" can exceed the current
// "Emails Found" count for a short date window).
function buildFlowPath(heights: number[], colWidth: number): string {
  const n = heights.length;
  const xs = heights.map((_, i) => i * colWidth);
  let top = `M ${xs[0]} ${CENTER_Y - heights[0] / 2}`;
  for (let i = 1; i < n; i++) {
    const midX = (xs[i - 1] + xs[i]) / 2;
    top += ` C ${midX} ${CENTER_Y - heights[i - 1] / 2}, ${midX} ${CENTER_Y - heights[i] / 2}, ${xs[i]} ${CENTER_Y - heights[i] / 2}`;
  }
  top += ` L ${VIEW_W} ${CENTER_Y - heights[n - 1] / 2}`;

  let bottom = ` L ${VIEW_W} ${CENTER_Y + heights[n - 1] / 2}`;
  for (let j = n - 1; j > 0; j--) {
    const midX2 = (xs[j - 1] + xs[j]) / 2;
    bottom += ` C ${midX2} ${CENTER_Y + heights[j] / 2}, ${midX2} ${CENTER_Y + heights[j - 1] / 2}, ${xs[j - 1]} ${CENTER_Y + heights[j - 1] / 2}`;
  }
  bottom += " Z";

  return top + bottom;
}

function findBiggestDrop(steps: PipelineStep[]) {
  let biggest: { from: PipelineStep; to: PipelineStep; change: number } | null = null;
  for (let i = 0; i < steps.length - 1; i++) {
    const from = steps[i].value;
    const to = steps[i + 1].value;
    if (from == null || to == null || from <= 0) continue;
    const change = (to - from) / from;
    if (change < 0 && (!biggest || change < biggest.change)) {
      biggest = { from: steps[i], to: steps[i + 1], change };
    }
  }
  return biggest;
}

export function PipelineFlowCard({ steps }: { steps: PipelineStep[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const values = steps.map((s) => s.value ?? 0);
  const maxVal = Math.max(1, ...values);
  const colWidth = VIEW_W / steps.length;
  const heights = values.map((v) => Math.max(MIN_BAND_H, (v / maxVal) * MAX_BAND_H));
  const pathD = buildFlowPath(heights, colWidth);

  const drop = findBiggestDrop(steps);
  const hoveredStep = hovered != null ? steps[hovered] : null;
  const prevStep = hovered != null && hovered > 0 ? steps[hovered - 1] : null;
  const pct =
    hoveredStep && prevStep && prevStep.value && hoveredStep.value != null
      ? ((hoveredStep.value - prevStep.value) / prevStep.value) * 100
      : null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex relative">
        {steps.map((step, i) => (
          <div key={step.key} className={cn("flex-1 min-w-0 px-4 py-4", i > 0 && "border-l border-border")}>
            <div className="flex items-start gap-1.5 text-[13px] text-muted-foreground min-h-8">
              {step.icon}
              <span>{step.label}</span>
            </div>
            <div className="font-display text-2xl font-semibold tabular-nums mt-0.5">
              {step.value == null ? "—" : formatNumber(step.value)}
            </div>
          </div>
        ))}
      </div>

      <div className="relative border-t border-border">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="block w-full h-[160px] md:h-[200px]"
        >
          <defs>
            <linearGradient id="pipelineFlowGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(var(--ring) / 0.22)" />
              <stop offset="100%" stopColor="hsl(var(--ring))" />
            </linearGradient>
          </defs>
          <path d={pathD} fill="url(#pipelineFlowGradient)" />
        </svg>

        <div className="absolute inset-0 flex">
          {steps.map((step, i) => (
            <div
              key={step.key}
              className={cn("flex-1 min-w-0", i > 0 && "border-l border-border/70")}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
            />
          ))}
        </div>

        {hoveredStep && hovered != null && (
          <div
            className="absolute top-3 -translate-x-1/2 rounded-lg bg-foreground text-background px-3.5 py-2.5 text-[13px] shadow-lg pointer-events-none z-10 whitespace-nowrap"
            style={{ left: `${((hovered + 0.5) / steps.length) * 100}%` }}
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-background/60 mb-0.5">
              {hoveredStep.label}
            </div>
            <div className="font-display text-base font-semibold">
              {hoveredStep.value == null ? "Not tracked yet" : hoveredStep.value.toLocaleString()}
            </div>
            {pct != null && (
              <div className="text-background/60 mt-0.5">
                {pct >= 0 ? "+" : ""}
                {pct.toFixed(0)}% vs {prevStep!.label}
              </div>
            )}
          </div>
        )}
      </div>

      {drop && (
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border bg-ring/10 text-ring text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Biggest drop: {drop.from.label} → {drop.to.label} ({Math.round(drop.change * 100)}%)
          </span>
        </div>
      )}
    </div>
  );
}
