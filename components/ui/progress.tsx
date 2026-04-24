import { cn } from "@/lib/utils";

type Props = {
  /** 0–100. If null, renders an indeterminate (animated) bar. */
  value: number | null;
  /** Visual weight. "running" pulses; "done"/"idle" are flat. */
  state?: "running" | "done" | "idle";
  className?: string;
  /** Bar thickness. Defaults to h-2. */
  size?: "sm" | "md";
};

// A single reusable progress bar. Replaces the inline bar divs that used to be
// copy-pasted across the crawl views. When `value` is null it shows an
// indeterminate sweep (we know work is happening but not how much).
export function Progress({ value, state = "running", className, size = "md" }: Props) {
  const track = size === "sm" ? "h-1.5" : "h-2";
  const fill =
    state === "running"
      ? "bg-primary"
      : state === "done"
        ? "bg-green-500"
        : "bg-muted-foreground/50";

  if (value == null) {
    return (
      <div className={cn(track, "w-full rounded-full bg-muted overflow-hidden", className)}>
        <div className={cn("h-full w-1/3 rounded-full animate-progress-indeterminate", fill)} />
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn(track, "w-full rounded-full bg-muted overflow-hidden", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-500 ease-out", fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
