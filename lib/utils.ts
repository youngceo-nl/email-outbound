import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

/*
 * Thresholds match the PDF's own tier bands for total_icp_score (0-12):
 * QUALIFIED_HIGH_PRIORITY 10-12, QUALIFIED 7-9, MANUAL_REVIEW 4-6, REJECTED
 * 0-3. Previously tuned for the old 0-10 commercial_fit scale (>=8/>=6) —
 * left uncorrected here would silently mis-color every score on the new
 * scale (an 8/12 MANUAL_REVIEW lead would read as green).
 */
export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 10) return "bg-green-500/20 text-green-700 dark:text-green-300";
  if (score >= 7) return "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300";
  return "bg-red-500/20 text-red-700 dark:text-red-300";
}
