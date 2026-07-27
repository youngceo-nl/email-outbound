import { detectPeriod, parsePrice, type Period } from "./assumptions/price";

/*
 * The offer ladder: every price found on a prospect's properties, classified into
 * rungs, and the report-level routing decision that falls out of it.
 *
 * The single most expensive mistake the old generator made was treating the one
 * price it found as *the* offer a webinar sells. A $12/mo app subscription is real,
 * but it is a low-rung capture product — modelling a launch on it produced a
 * -$5,278 net and a -699.7% margin next to a "proceed" recommendation. The cure is
 * not a better prompt; it is asking which rung a price occupies before it goes
 * anywhere near the calculator.
 *
 * Operating rule this module encodes:
 *
 *   A direct-checkout webinar is a mid-ticket instrument. Below roughly $200 the
 *   math cannot cover cost per lead plus fixed costs at any conversion rate. Above
 *   roughly $3,000 direct checkout stops working and an application step is
 *   required.
 *
 * Everything here is pure and deterministic — stage 7 of the pipeline is rules,
 * not a model, so the same ladder always produces the same report shape.
 */

export type Rung = "low" | "mid" | "high";
export const RUNGS: Rung[] = ["low", "mid", "high"];

export const RUNG_LABEL: Record<Rung, string> = {
  low: "Low ticket (capture and qualify)",
  mid: "Mid ticket (the webinar instrument)",
  high: "High ticket (application + call)",
};

/*
 * Structural rung boundaries, from the operating rule above. These bound where a
 * *funnel mechanism* works and are not niche-specific — what varies by niche is
 * where within the mid band a given category prices, which is the price band's
 * job, not these thresholds'.
 */
export const MID_FLOOR = 200;
export const HIGH_FLOOR = 3000;

/** One price string captured somewhere, before parsing. */
export type CapturedPrice = {
  raw: string;
  /** Tier or program name if the page put one next to the price. */
  label: string | null;
  url: string | null;
  /** Where it was seen: "offer_page", "linktree", "llm_extract", … */
  source: string;
  /**
   * Surrounding page text, when the extractor kept it. Advisory only: pages
   * often separate "$97" from "billed monthly", so the billing period may live
   * here rather than in the price string itself.
   */
  context?: string | null;
};

/** A captured price that parsed, classified into its rung. */
export type LadderEntry = {
  raw: string;
  label: string | null;
  /**
   * The checkout transaction — the figure the rung is judged on. The operating
   * rule is checkout math: below ~$200 collected at the point of sale, no
   * conversion rate covers cost per lead, and that stays true whether the $29 is
   * one-time or the first of many. A $297/mo coaching program is a mid-ticket
   * checkout; a $29/mo community is a capture product.
   */
  amount: number;
  period: Period;
  /** The yearly relationship a recurring price implies — context, not the rung test. */
  annualized: number;
  currency: string;
  url: string | null;
  source: string;
  rung: Rung;
  /** Carried from the parser: ranges, plans, and multi-figure pages need a human. */
  ambiguous: boolean;
};

export type Ladder = {
  rungs: Record<Rung, LadderEntry[]>;
  missing: Rung[];
  /** Prices that were captured but did not parse — kept visible, never guessed at. */
  unparsed: CapturedPrice[];
  confidence: "high" | "medium" | "low";
};

/**
 * What mid-ticket sells for in this prospect's category. Until niche price
 * research runs (v3 §3.4), the band is a labelled starting point from the
 * defaults table — `tier` says which, and the report prints it.
 */
export type PriceBand = {
  mid: number;
  high: number;
  source: string;
  tier: "researched" | "assumed";
};

/**
 * The five report shapes. Chosen by evidence, not by a model — this enum is the
 * anti-template mechanism: a sparse discovery case and a repricing case are
 * different documents, not one document with different adjectives.
 */
export type ReportRoute =
  | "standard" //           mid exists, priced in band — model the webinar selling it
  | "missing_mid" //        low exists, no mid — the gap IS the opportunity (strongest report)
  | "application_funnel" // only high — webinar + application step, not direct checkout
  | "repricing" //          mid exists but far below band — current vs band, side by side
  | "discovery"; //         nothing found — no revenue projection at all

export const ROUTE_THESIS: Record<ReportRoute, string> = {
  standard: "A direct-checkout webinar selling the existing mid-ticket offer.",
  missing_mid:
    "The audience and capture products exist; the mid-ticket offer a webinar sells does not. The gap is the opportunity.",
  application_funnel:
    "The offer is above direct-checkout range. The webinar qualifies and books applications rather than selling at checkout.",
  repricing:
    "A mid-ticket offer exists but is priced far below its category. The launch case rests on repricing, shown side by side.",
  discovery: "No offer or price is publicly visible. This is a diagnostic, not a projection.",
};

/** Judged on the checkout transaction — see LadderEntry.amount for why. */
export function classifyRung(transactionAmount: number): Rung {
  if (transactionAmount < MID_FLOOR) return "low";
  if (transactionAmount < HIGH_FLOOR) return "mid";
  return "high";
}

/**
 * Parse and classify everything captured. Unparseable strings are kept — a price
 * we saw but could not read is a fact worth surfacing, and silently dropping it
 * is how the $12 became the only number in the model.
 */
export function buildLadder(captured: CapturedPrice[]): Ladder {
  const rungs: Record<Rung, LadderEntry[]> = { low: [], mid: [], high: [] };
  const unparsed: CapturedPrice[] = [];
  const seen = new Set<string>();

  for (const capture of captured) {
    // The same price often appears on the offer page and again via the LLM pass.
    const dedupeKey = capture.raw.replace(/\s+/g, "").toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const parsed = parsePrice(capture.raw);
    if (!parsed.ok) {
      unparsed.push(capture);
      continue;
    }
    // "$97" with "billed monthly" three words away: the period lives in the
    // surrounding text, not the price string. Context can only add a period the
    // raw string lacked — never remove one it stated.
    const period: Period =
      parsed.price.period === "one_time" && capture.context ? detectPeriod(capture.context) : parsed.price.period;
    const annualized = period === "monthly" ? parsed.price.amount * 12 : parsed.price.amount;
    rungs[classifyRung(parsed.price.amount)].push({
      raw: capture.raw,
      label: capture.label,
      amount: parsed.price.amount,
      period,
      annualized,
      currency: parsed.price.currency,
      url: capture.url,
      source: capture.source,
      rung: classifyRung(parsed.price.amount),
      ambiguous: parsed.price.ambiguous,
    });
  }

  // Highest first within a rung: pages lead with discounts, and the top figure is
  // the better read of what the offer actually costs.
  for (const rung of RUNGS) rungs[rung].sort((a, b) => b.amount - a.amount);

  const missing = RUNGS.filter((rung) => rungs[rung].length === 0);
  const parsedCount = RUNGS.reduce((n, rung) => n + rungs[rung].length, 0);
  const anyAmbiguous = RUNGS.some((rung) => rungs[rung].some((entry) => entry.ambiguous));

  return {
    rungs,
    missing,
    unparsed,
    confidence: parsedCount >= 2 && !anyAmbiguous ? "high" : parsedCount >= 1 ? "medium" : "low",
  };
}

/**
 * "Far below band": the mid offer exists as a mechanism but is priced under half
 * of what the category's mid tickets sell for. Below that line the economics
 * argument is about the price, not the funnel, and the report has to say so.
 */
export const UNDERPRICED_RATIO = 0.5;

export type RouteDecision = {
  route: ReportRoute;
  /** The mid-rung entry the report models, when one exists. */
  modeledEntry: LadderEntry | null;
  /** One sentence for the dossier and the internal trace: why this shape. */
  reasoning: string;
};

export function routeLadder(ladder: Ladder, band: PriceBand): RouteDecision {
  const bestMid = ladder.rungs.mid[0] ?? null;
  const bestLow = ladder.rungs.low[0] ?? null;
  const bestHigh = ladder.rungs.high[0] ?? null;

  if (bestMid) {
    if (bestMid.amount < band.mid * UNDERPRICED_RATIO) {
      return {
        route: "repricing",
        modeledEntry: bestMid,
        reasoning: `Mid-ticket exists at ${bestMid.raw} but sits under ${Math.round(UNDERPRICED_RATIO * 100)}% of the category band (${band.source}); the case is repricing, not the funnel.`,
      };
    }
    return {
      route: "standard",
      modeledEntry: bestMid,
      reasoning: `Mid-ticket exists at ${bestMid.raw}, within range of the category band.`,
    };
  }

  if (bestHigh && !bestLow) {
    return {
      route: "application_funnel",
      modeledEntry: null,
      reasoning: `Only a high-ticket offer (${bestHigh.raw}) is visible — above direct-checkout range, so the webinar books applications.`,
    };
  }

  if (bestLow) {
    return {
      route: "missing_mid",
      modeledEntry: null,
      reasoning: `A low-ticket capture product (${bestLow.raw}) exists and no mid-ticket does — the missing rung is the opportunity.`,
    };
  }

  if (bestHigh) {
    // High + low both present is caught above; this is high alongside nothing.
    return {
      route: "application_funnel",
      modeledEntry: null,
      reasoning: `Only a high-ticket offer (${bestHigh.raw}) is visible.`,
    };
  }

  return {
    route: "discovery",
    modeledEntry: null,
    reasoning: "No price parsed from any property. Projections would be assumption stacked on assumption.",
  };
}

/** The §3.3 payload shape, for the dossier and for storage. */
export function ladderSummary(ladder: Ladder, decision: RouteDecision, band: PriceBand) {
  return {
    rungs: Object.fromEntries(
      RUNGS.map((rung) => [
        rung,
        ladder.rungs[rung].map((entry) => ({
          name: entry.label,
          price: entry.amount,
          period: entry.period,
          annualized: entry.annualized,
          url: entry.url,
          source: entry.source,
        })),
      ]),
    ),
    missing: ladder.missing,
    confidence: ladder.confidence,
    category_band: { mid: band.mid, high: band.high, basis: `${band.tier}: ${band.source}` },
    route: decision.route,
    route_reasoning: decision.reasoning,
    thesis: ROUTE_THESIS[decision.route],
  };
}
