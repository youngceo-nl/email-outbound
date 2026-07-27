import type { ExpenseLine, ScenarioInputs } from "../calculations/formulas";
import type { Tier } from "../schema";

/*
 * Where the numbers come from when nothing was scraped and nobody typed one in.
 *
 * A deliberate constraint on this file: a value is only tagged `researched` if a
 * real, citable source backs it. Everything else is `assumed` and says so in the
 * report. It would be easy to dress the whole table up as "category benchmarks"
 * and it would read more convincingly — but a prospect who asks "where did 25%
 * come from?" has to get a true answer, and the reference report's own §0 makes
 * that separation the point of the document.
 *
 * The niche table below is a set of starting points, not research. Tune it from
 * closed deals; it is wired to be editable from Settings for that reason.
 */

/**
 * Two columns, matching the calculator's projected / worst-case CPL stress test.
 * They differ *only* in cost per lead — every other input is shared, which is
 * exactly how the calculator behaves.
 */
export type ScenarioKey = "projected" | "worst";
export const SCENARIO_KEYS: ScenarioKey[] = ["projected", "worst"];
export const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  projected: "Projected",
  worst: "Worst case",
};

/** Inputs the resolver owns. CPL is per-scenario; the rest are shared. */
export type AssumptionKey =
  | "front_end_price"
  | "backend_offer_price"
  | "ad_spend"
  | "paid_cost_per_registration"
  | "worst_case_cpl"
  | "organic_visitors"
  | "organic_optin_rate"
  | "show_up_rate"
  | "front_end_purchase_rate"
  | "backend_ascension_rate";

export const ASSUMPTION_LABEL: Record<AssumptionKey, string> = {
  front_end_price: "Average deal value",
  backend_offer_price: "Backend offer price",
  ad_spend: "Ad spend",
  paid_cost_per_registration: "Cost per lead",
  worst_case_cpl: "Worst-case cost per lead",
  organic_visitors: "Organic registration-page visitors",
  organic_optin_rate: "Opt-in rate (organic only)",
  show_up_rate: "Show-up rate",
  front_end_purchase_rate: "Sign-up rate (of live attendees)",
  backend_ascension_rate: "Backend ascension rate",
};

export const ASSUMPTION_FORMAT: Record<AssumptionKey, "usd" | "pct" | "count"> = {
  front_end_price: "usd",
  backend_offer_price: "usd",
  ad_spend: "usd",
  paid_cost_per_registration: "usd",
  worst_case_cpl: "usd",
  organic_visitors: "count",
  organic_optin_rate: "pct",
  show_up_rate: "pct",
  front_end_purchase_rate: "pct",
  backend_ascension_rate: "pct",
};

/**
 * Standard P&L lines.
 *
 * These three are what the reference report's P&L contains, in this order and
 * with these types — which is the evidence that it was produced by the
 * calculator. Editable per report; percentage lines are fractions of net revenue.
 */
export const DEFAULT_EXPENSES: ExpenseLine[] = [
  { name: "Sales / partner commission", type: "percent_of_revenue", value: 0.175 },
  { name: "Tools / software", type: "fixed", value: 400 },
  { name: "Fixed performance floor", type: "fixed", value: 3000 },
];

/**
 * The fallback ladder. Prices reflect what Conversion Brands sells against — a
 * ~$2k front end ascending to $5k — rather than the reference prospect's own
 * $997/$20k, which were his real numbers, not a default.
 *
 * CPL defaults come from the calculator itself: $15 projected, $50 worst case.
 * `organic_visitors` is absent because it is derived from follower count; see
 * deriveOrganicVisitors.
 */
export const DEFAULTS = {
  front_end_price: 2000,
  backend_offer_price: 5000,
  ad_spend: 2500,
  paid_cost_per_registration: 15,
  worst_case_cpl: 50,
  organic_optin_rate: 0.25,
  show_up_rate: 0.25,
  front_end_purchase_rate: 0.15,
  backend_ascension_rate: 0.025,
} satisfies Record<Exclude<AssumptionKey, "organic_visitors">, number>;

/**
 * The only genuinely sourced value here, and the only one that earns the
 * `researched` tier. The reference report cites third-party Meta lead-gen
 * benchmarks for a directional CPL band and is explicit that it is not account
 * data — the same caveat travels with it.
 */
export const CPL_SOURCE = "Conversion Brands calculator default, cross-checked against third-party Meta lead-gen benchmarks — not the prospect's ad account";
export const CPL_TIER: Tier = "researched";

/**
 * Registration-page visitors implied by audience size.
 *
 * Followers are not traffic — the reference report is emphatic about this, and
 * treating an 84k audience as 84k visitors is the fastest way to make these
 * projections fantasy. What a follower count supports is a promotion *reach*
 * rate: the share of an audience that clicks through to a registration page over
 * a launch's worth of posting.
 *
 * 2% is the working rate. On the reference's 191k account that gives ~3,800
 * visitors against its hand-picked 2,500, so it is the same order and slightly
 * more optimistic — which is the right direction, because this model has no input
 * for an email list and a real launch's largest traffic source is usually the
 * list. Under-modelling organic reach was making every projection read low.
 */
export const ORGANIC_REACH_RATE = 0.02;

/** Floor so a small or unknown audience still models a testable launch. */
const MIN_ORGANIC_VISITORS = 300;

export function deriveOrganicVisitors(followers: number | null): number {
  if (!followers || followers <= 0) return MIN_ORGANIC_VISITORS;
  return Math.max(MIN_ORGANIC_VISITORS, Math.round(followers * ORGANIC_REACH_RATE));
}

/**
 * Per-niche starting points, matched against the free-text niche and business
 * model the lead scorer assigns.
 *
 * Traffic cost is expressed as a *multiplier* on both CPLs rather than an
 * absolute value. Writing an absolute number here was a real bug: the wellness
 * profile set CPL to $45, which is a worst-case figure, so the projected column
 * silently ran worst-case traffic economics and every wellness projection came
 * out roughly 40% low.
 */
export type NicheProfile = {
  id: string;
  label: string;
  match: RegExp;
  overrides: Partial<Record<Exclude<AssumptionKey, "paid_cost_per_registration" | "worst_case_cpl">, number>>;
  /** Applied to both projected and worst-case CPL. 1 = no adjustment. */
  cplMultiplier?: number;
  /**
   * What mid-ticket sells for in this category: the band's midpoint and its top
   * end within direct-checkout range. Starting points, tier "assumed" — niche
   * price research (v3 §3.4) replaces these per prospect with cited competitors.
   */
  priceBand?: { mid: number; high: number };
  warning?: string;
};

/** Band when no niche matches. Mirrors the fallback ladder's $2k front end. */
export const DEFAULT_PRICE_BAND = { mid: 2000, high: 2500 };

/*
 * Order is precedence — the first match wins, so specific verticals must come
 * before general ones. "Breathwork and wellness coaching" has to resolve as
 * health/fitness, not as generic coaching, which is why the broad /coach/ pattern
 * sits at the bottom as the catch-all.
 */
export const NICHE_PROFILES: NicheProfile[] = [
  {
    id: "health_fitness",
    label: "Health / fitness / wellness",
    match: /health|fitness|nutrition|wellness|breath|yoga|somatic|personal train|nervous system/i,
    overrides: { front_end_price: 997, backend_offer_price: 5000 },
    priceBand: { mid: 997, high: 1997 },
    // The reference notes wellness traffic runs materially above the education
    // average, so both CPLs move up together.
    cplMultiplier: 1.6,
  },
  {
    id: "real_estate_finance",
    label: "Real estate / finance",
    match: /real\s*estate|realtor|mortgage|insurance|financ|invest|trading|crypto/i,
    overrides: { front_end_price: 2000, backend_offer_price: 10000 },
    priceBand: { mid: 2000, high: 2500 },
    cplMultiplier: 1.4,
  },
  {
    id: "ecommerce_product",
    label: "E-commerce / physical product",
    match: /e.?comm|shopify|dropship|retail|apparel|supplement/i,
    overrides: { front_end_price: 500 },
    priceBand: { mid: 500, high: 997 },
    warning:
      "Physical-product businesses rarely convert on a webinar-to-checkout model. Confirm there is an information or coaching offer before proposing this.",
  },
  {
    id: "agency_service",
    label: "Agency / done-for-you service",
    match: /agenc|done.for.you|dfy|freelanc|smma/i,
    overrides: { front_end_price: 1500, backend_offer_price: 10000, backend_ascension_rate: 0.05 },
    priceBand: { mid: 1500, high: 2500 },
  },
  {
    id: "course_community",
    label: "Course / paid community",
    match: /course|community|membership|skool|cohort|academy/i,
    overrides: { front_end_price: 997, backend_offer_price: 5000, front_end_purchase_rate: 0.12 },
    priceBand: { mid: 997, high: 1997 },
  },
  {
    // Catch-all, deliberately last: /coach/ matches most of the verticals above.
    id: "coaching_consulting",
    label: "Coaching / consulting",
    match: /coach|consult|mentor|advisor|business\s*strat/i,
    overrides: { front_end_price: 2000, backend_offer_price: 10000 },
    priceBand: { mid: 2000, high: 2500 },
  },
];

export function matchNiche(niche: string | null, businessModel: string | null): NicheProfile | null {
  const haystack = [niche, businessModel].filter(Boolean).join(" ");
  if (!haystack) return null;
  return NICHE_PROFILES.find((profile) => profile.match.test(haystack)) ?? null;
}

/** Shared shape both scenarios are built from; only CPL differs between them. */
export type ResolvedInputs = Omit<ScenarioInputs, "paid_cost_per_registration">;

/**
 * Everything a human can set before generating. The assumption keys flow through
 * the cascade at `human` tier; `ladder_low_price` exists only for the ladder —
 * an entry product has no scenario input, but it changes the routing (a low rung
 * that exists is evidence).
 */
export type ReportOverrides = Partial<Record<AssumptionKey, number>> & { ladder_low_price?: number };
