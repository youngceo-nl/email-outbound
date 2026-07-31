import Link from "next/link";
import { cn } from "@/lib/utils";
import { RANGE_PRESETS, type RangePreset } from "@/lib/date-range";

export function DateRangeBar({
  activePreset,
  customStart,
  customEnd,
}: {
  activePreset: RangePreset | null;
  customStart?: string;
  customEnd?: string;
}) {
  const isCustom = activePreset === null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {RANGE_PRESETS.map((p) => (
        <Link
          key={p.key}
          href={`/?range=${p.key}`}
          className={cn(
            "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
            !isCustom && p.key === activePreset
              ? "bg-ring border-ring text-white"
              : "bg-card border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {p.label}
        </Link>
      ))}

      <form method="get" action="/" className="flex items-center gap-1.5">
        <input
          type="date"
          name="start"
          defaultValue={customStart}
          className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          name="end"
          defaultValue={customEnd}
          className="rounded-md border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground"
        />
        <button
          type="submit"
          className={cn(
            "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
            isCustom ? "bg-ring border-ring text-white" : "bg-card border-border text-muted-foreground hover:bg-muted",
          )}
        >
          Apply
        </button>
      </form>
    </div>
  );
}
