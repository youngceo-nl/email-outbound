/*
 * Parses the free-text price the funnel enricher scrapes off an offer page
 * (leads.funnel_price) into something the calculator can use.
 *
 * The column is text because pages say "$997", "$97/mo", "from £49", "2 payments
 * of $499" and worse. Getting this wrong is expensive in a specific way: an
 * unnoticed monthly price makes the whole revenue model wrong by an order of
 * magnitude, so anything ambiguous is flagged for a human rather than guessed at.
 */

export type Period = "one_time" | "monthly" | "annual";

export type ParsedPrice = {
  amount: number;
  currency: string;
  period: Period;
  /** True when the page showed a range, several prices, or a payment plan — the
   *  figure is a best guess and the panel must surface it for confirmation. */
  ambiguous: boolean;
  raw: string;
};

export type PriceParseResult =
  | { ok: true; price: ParsedPrice }
  | { ok: false; reason: "empty" | "no_number" | "implausible" | "call_for_price" };

const SYMBOLS: Array<[string, string]> = [
  ["US$", "USD"],
  ["A$", "AUD"],
  ["C$", "CAD"],
  ["NZ$", "NZD"],
  ["$", "USD"],
  ["€", "EUR"],
  ["£", "GBP"],
];

const CODES = ["USD", "EUR", "GBP", "AUD", "CAD", "NZD"];

/*
 * Sanity band. Below a dollar is a parse artifact (a rating, a version number);
 * above half a million is not a funnel offer. Either way, a figure outside this
 * range would be more damaging in the model than no figure at all, since a
 * missing price falls back to a labelled assumption while a wrong one is
 * presented as observed fact.
 */
const MIN = 1;
const MAX = 500_000;

/** Pages that quote no number: "book a call", "apply", "contact for pricing". */
const CALL_FOR_PRICE = /\b(contact|enquir|inquir|apply|book a call|schedule a call|request (a )?(quote|pricing)|custom pricing|talk to)\b/i;

/** Matches 1,997.00 / 997 / 9.99 / 1.5k, capturing an optional k multiplier. */
const NUMBER = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d+)?)\s*(k)?/gi;

function detectCurrency(text: string): string {
  for (const [symbol, code] of SYMBOLS) {
    if (text.includes(symbol)) return code;
  }
  const upper = text.toUpperCase();
  for (const code of CODES) {
    // Word-boundary check so "USDA" or a "cad" inside another word doesn't match.
    if (new RegExp(`\\b${code}\\b`).test(upper)) return code;
  }
  return "USD";
}

function detectPeriod(text: string): Period {
  if (/(\/|per\s*)\s*(mo\b|month|m\b)|\bmonthly\b|\bp\/m\b/i.test(text)) return "monthly";
  if (/(\/|per\s*)\s*(yr\b|year)|\bannual(ly)?\b/i.test(text)) return "annual";
  return "one_time";
}

/** A payment plan ("3 payments of $499") is not a unit price — always confirm. */
const PAYMENT_PLAN = /\b(\d+\s*(x|payments?|installments?)\s*(of)?|split into|pay(ments)? over)\b/i;

export function parsePrice(raw: string | null | undefined): PriceParseResult {
  if (!raw || !raw.trim()) return { ok: false, reason: "empty" };
  const text = raw.trim();

  const amounts: number[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const [, digits, k] = match;
    let value = Number.parseFloat(digits.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (k) value *= 1000;
    amounts.push(value);
  }

  const plausible = amounts.filter((n) => n >= MIN && n <= MAX);
  if (plausible.length === 0) {
    // "Book a call" with no number is a meaningfully different outcome from a
    // page we simply failed to read — the former is a fact about their funnel.
    if (CALL_FOR_PRICE.test(text)) return { ok: false, reason: "call_for_price" };
    return { ok: false, reason: amounts.length > 0 ? "implausible" : "no_number" };
  }

  const distinct = new Set(plausible);
  const isPlan = PAYMENT_PLAN.test(text);

  return {
    ok: true,
    price: {
      // Highest of several: pages lead with a discounted or instalment figure and
      // show the real price alongside it, so the maximum is the better guess at
      // the actual offer value. Flagged ambiguous either way.
      amount: Math.max(...plausible),
      currency: detectCurrency(text),
      period: detectPeriod(text),
      ambiguous: distinct.size > 1 || isPlan,
      raw: text,
    },
  };
}

/**
 * The price to model a webinar front-end offer on.
 *
 * A recurring price is not a front-end ticket: a $97/mo community and a $997
 * course are different businesses, and silently annualising would invent a
 * $1,164 offer nobody sells. So recurring prices return their annualised value
 * *and* demand confirmation — the number is a starting point for the strategist,
 * never something the report states on its own authority.
 */
export function frontEndPriceFrom(price: ParsedPrice): { amount: number; needsConfirmation: boolean; note: string } {
  if (price.period === "monthly") {
    return {
      amount: price.amount * 12,
      needsConfirmation: true,
      note: `${price.raw} is recurring — shown here as 12 months. Confirm the offer being sold at the webinar.`,
    };
  }
  if (price.period === "annual") {
    return {
      amount: price.amount,
      needsConfirmation: true,
      note: `${price.raw} is an annual price. Confirm whether the webinar sells this or a one-time offer.`,
    };
  }
  return {
    amount: price.amount,
    needsConfirmation: price.ambiguous,
    note: price.ambiguous
      ? `${price.raw} showed more than one figure — the highest was taken. Confirm the intended offer price.`
      : `Observed on their offer page.`,
  };
}
