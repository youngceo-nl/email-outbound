/*
 * Display formatting. The one place figures become strings.
 *
 * Full precision is carried all the way from the calculator to here and rounded
 * only at this boundary — which is why the reference report shows "27 buyers"
 * next to "$27,106" rather than 27 × $997 = $26,919. Rounding the buyer count
 * first and multiplying would understate revenue by $187 on that example, and
 * every scenario in the document would be quietly self-inconsistent.
 */

const usdFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const countFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Money, whole dollars. Rounds at the display boundary, never before. */
export function usd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return usdFmt.format(value);
}

/** Whole units — registrations, attendees, buyers. */
export function count(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return countFmt.format(value);
}

/** A rate held as a fraction (0.175) rendered as a percentage ("17.5%"). */
export function pct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  const scaled = value * 100;
  // Drop a trailing ".0" so round rates read as "25%" not "25.0%".
  const fixed = scaled.toFixed(decimals);
  return `${fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed}%`;
}

/** Follower counts and similar — "191K" rather than "191,000". */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return compactFmt.format(value);
}

/**
 * Fractional people, stated as the range it really is.
 *
 * Backend ascension yields values like 0.68 clients per launch. Printing "1"
 * promises a $20k client every launch; printing "0.68" is meaningless to a
 * reader. The reference document's own framing is the honest one: show the
 * arithmetic value and the practical outcome separately.
 */
export function peopleRange(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1) {
    const low = Math.floor(value);
    return low === Math.ceil(value) ? String(low) : `${low}-${Math.ceil(value)}`;
  }
  return value > 0 ? "0 or 1" : "0";
}

/** "25 Jul 2026" — unambiguous across locales, which matters on a dated observation. */
export function reportDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
