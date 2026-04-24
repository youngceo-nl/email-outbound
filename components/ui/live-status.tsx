import { cn } from "@/lib/utils";

// Pulsing dot + plain-language status line. Used by every live (auto-refreshing)
// view so the "is this updating?" indicator is consistent everywhere.
export function LiveStatus({ active, className }: { active: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <LiveDot active={active} />
      {active ? "Live — refreshing automatically" : "Up to date — checking every few seconds"}
    </span>
  );
}

export function LiveDot({ active }: { active: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2" aria-hidden>
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
      )}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          active ? "bg-green-500" : "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}
