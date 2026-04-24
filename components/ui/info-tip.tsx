"use client";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// A small "(?)" affordance that reveals a plain-language explanation on hover or
// focus. Used to demystify metric abbreviations (engagement rate, score, …)
// without cluttering the UI. Falls back to the native title tooltip too.
export function InfoTip({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn("group/tip relative inline-flex align-middle", className)} tabIndex={0}>
      <HelpCircle
        className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help"
        aria-label={text}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden -translate-x-1/2 whitespace-normal rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-normal normal-case leading-snug text-background shadow-md w-48 text-left group-hover/tip:block group-focus/tip:block"
      >
        {text}
      </span>
    </span>
  );
}

// Header cell text + an info tooltip, kept on one line. For data-table columns.
export function HeaderWithTip({ label, tip }: { label: string; tip: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTip text={tip} />
    </span>
  );
}
