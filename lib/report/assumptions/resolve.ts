import type { ExpenseLine, ScenarioInputs } from "../calculations/formulas";
import { count, pct, reportDate, usd } from "../format";
import type { ResolvedAssumption, Tier } from "../schema";
import {
  ASSUMPTION_FORMAT,
  ASSUMPTION_LABEL,
  CPL_SOURCE,
  CPL_TIER,
  DEFAULT_EXPENSES,
  DEFAULTS,
  ORGANIC_REACH_RATE,
  deriveOrganicVisitors,
  matchNiche,
  type AssumptionKey,
  type ScenarioKey,
} from "./defaults";
import { frontEndPriceFrom, parsePrice } from "./price";

/*
 * The assumptions cascade.
 *
 * Every input resolves through one fixed precedence, and each carries the tier it
 * resolved at so the report can state its own basis:
 *
 *   1  human       a strategist typed it            → beats everything
 *   2  observed    scraped off their offer page
 *   3  researched  a citable third-party benchmark
 *   4  assumed     the fallback ladder / niche starting point
 *
 * The tiers are not decoration. §0's known-limits list and the assumptions table
 * are generated from them, which is what stops a generated document from
 * presenting a guess as a finding.
 *
 * Only cost per lead differs between the two scenarios, mirroring the
 * calculator's worst-case CPL stress test — so there is no scenario-scaling logic
 * here at all. Everything else is one shared value.
 */

/** Inputs held as fractions, clamped to 0..1 when a human overrides them. */
const RATE_KEYS = new Set<AssumptionKey>([
  "organic_optin_rate",
  "show_up_rate",
  "front_end_purchase_rate",
  "backend_ascension_rate",
]);

const ALL_KEYS = Object.keys(ASSUMPTION_LABEL) as AssumptionKey[];

export type ResolveArgs = {
  followers: number | null;
  niche: string | null;
  businessModel: string | null;
  /** leads.funnel_price — free text off their offer page. */
  funnelPrice: string | null;
  funnelPriceObservedAt: string | null;
  funnelPlatform: string | null;
  overrides?: Partial<Record<AssumptionKey, number>>;
  /** Replaces the standard P&L lines entirely when provided. */
  expenses?: ExpenseLine[];
  confirmedBy?: string | null;
  /**
   * The deal value the report's route proposes — supplied by the ladder, which
   * knows what rung the scraped price sits on. Without this, a $100 capture
   * product scraped off a page becomes the "observed" front-end price and the
   * whole launch models a product no webinar would sell. Beats the raw
   * funnel-price parse; loses to a human override.
   */
  frontEndCandidate?: { value: number; tier: Tier; source: string; needsConfirmation: boolean } | null;
  /** An observed high-ticket offer, used as the backend when nothing beats it. */
  backendCandidate?: { value: number; source: string } | null;
};

export type ResolvedInput = {
  key: AssumptionKey;
  label: string;
  value: number;
  tier: Tier;
  source: string;
  needsConfirmation: boolean;
};

export type ResolveResult = {
  inputs: Record<ScenarioKey, ScenarioInputs>;
  expenses: ExpenseLine[];
  resolved: ResolvedInput[];
  assumptions: ResolvedAssumption[];
  needsConfirmation: AssumptionKey[];
  warnings: string[];
};

function clamp(key: AssumptionKey, value: number): number {
  if (RATE_KEYS.has(key)) return Math.min(1, Math.max(0, value));
  return Math.max(0, value);
}

function formatValue(key: AssumptionKey, value: number): string {
  switch (ASSUMPTION_FORMAT[key]) {
    case "usd":
      return usd(value);
    case "pct":
      return pct(value);
    case "count":
      return count(value);
  }
}

export function resolveAssumptions(args: ResolveArgs): ResolveResult {
  const overrides = args.overrides ?? {};
  const niche = matchNiche(args.niche, args.businessModel);
  const warnings: string[] = [];
  if (niche?.warning) warnings.push(niche.warning);

  const parsed = parsePrice(args.funnelPrice);
  if (!parsed.ok && parsed.reason === "call_for_price") {
    // Not a failure — a finding about their funnel, and it changes the
    // recommendation, since they already gate on a call.
    warnings.push(
      "Their offer page quotes no price and asks prospects to book a call. The deal value below is an assumption, and the strategy should account for an existing call-gated funnel.",
    );
  }

  const resolved = ALL_KEYS.map((key) => resolveOne(key, { args, overrides, niche, parsed, warnings }));
  const byKey = new Map(resolved.map((r) => [r.key, r.value]));
  const expenses = args.expenses ?? DEFAULT_EXPENSES;

  const shared = {
    organic_visitors: byKey.get("organic_visitors")!,
    organic_optin_rate: byKey.get("organic_optin_rate")!,
    ad_spend: byKey.get("ad_spend")!,
    show_up_rate: byKey.get("show_up_rate")!,
    front_end_purchase_rate: byKey.get("front_end_purchase_rate")!,
    front_end_price: byKey.get("front_end_price")!,
    backend_ascension_rate: byKey.get("backend_ascension_rate")!,
    backend_offer_price: byKey.get("backend_offer_price")!,
    expenses,
  };

  return {
    inputs: {
      projected: { ...shared, paid_cost_per_registration: byKey.get("paid_cost_per_registration")! },
      worst: { ...shared, paid_cost_per_registration: byKey.get("worst_case_cpl")! },
    },
    expenses,
    resolved,
    assumptions: resolved.map<ResolvedAssumption>((r) => ({
      key: r.key,
      label: r.label,
      display: formatValue(r.key, r.value),
      tier: r.tier,
      source: r.source,
    })),
    needsConfirmation: resolved.filter((r) => r.needsConfirmation).map((r) => r.key),
    warnings,
  };
}

type ResolveOneCtx = {
  args: ResolveArgs;
  overrides: Partial<Record<AssumptionKey, number>>;
  niche: ReturnType<typeof matchNiche>;
  parsed: ReturnType<typeof parsePrice>;
  warnings: string[];
};

function resolveOne(key: AssumptionKey, ctx: ResolveOneCtx): ResolvedInput {
  const { args, overrides, niche, parsed, warnings } = ctx;
  const label = ASSUMPTION_LABEL[key];

  // ── 1. human ──────────────────────────────────────────────────────────────
  const override = overrides[key];
  if (override !== undefined && Number.isFinite(override)) {
    return {
      key,
      label,
      value: clamp(key, override),
      tier: "human",
      source: args.confirmedBy ? `Confirmed by ${args.confirmedBy}` : "Entered by the Conversion Brands team",
      needsConfirmation: false,
    };
  }

  // ── 2. observed / route-proposed ──────────────────────────────────────────
  // The ladder outranks the raw parse: it has already decided which rung the
  // scraped price occupies and what deal value this report should model.
  if (key === "front_end_price" && args.frontEndCandidate) {
    const candidate = args.frontEndCandidate;
    return {
      key,
      label,
      value: candidate.value,
      tier: candidate.tier,
      source: candidate.source,
      needsConfirmation: candidate.needsConfirmation,
    };
  }
  if (key === "backend_offer_price" && args.backendCandidate) {
    return {
      key,
      label,
      value: args.backendCandidate.value,
      tier: "observed",
      source: args.backendCandidate.source,
      needsConfirmation: true,
    };
  }
  if (key === "front_end_price" && parsed.ok) {
    const front = frontEndPriceFrom(parsed.price);
    const where = args.funnelPlatform ? `their ${args.funnelPlatform} page` : "their offer page";
    const when = args.funnelPriceObservedAt ? `, ${reportDate(args.funnelPriceObservedAt)}` : "";
    if (front.needsConfirmation) warnings.push(front.note);

    return {
      key,
      label,
      value: front.amount,
      tier: "observed",
      source: `${parsed.price.raw} on ${where}${when}`,
      needsConfirmation: front.needsConfirmation,
    };
  }

  // ── 3. researched ─────────────────────────────────────────────────────────
  // Both CPLs come from the calculator's own defaults, adjusted by the niche
  // multiplier. Applying a multiplier keeps the projected/worst relationship
  // intact — the earlier version wrote an absolute worst-case figure into the
  // projected column and understated every wellness projection by ~40%.
  if (key === "paid_cost_per_registration" || key === "worst_case_cpl") {
    const base = key === "worst_case_cpl" ? DEFAULTS.worst_case_cpl : DEFAULTS.paid_cost_per_registration;
    const multiplier = niche?.cplMultiplier ?? 1;
    if (multiplier !== 1) {
      return {
        key,
        label,
        value: base * multiplier,
        // Once we scale it, the number is partly our own judgement and can no
        // longer claim to be the cited benchmark.
        tier: "assumed",
        source: `${CPL_SOURCE}, scaled ${multiplier}x for ${niche!.label.toLowerCase()} — the adjustment is our estimate`,
        needsConfirmation: false,
      };
    }
    return { key, label, value: base, tier: CPL_TIER, source: CPL_SOURCE, needsConfirmation: false };
  }

  // ── 4. assumed ────────────────────────────────────────────────────────────
  if (key === "organic_visitors") {
    const value = deriveOrganicVisitors(args.followers);
    // The follower count is observed; the share of it that becomes traffic is
    // not. That makes this an assumption resting on an observation, and the
    // source line has to say both halves.
    const source = args.followers
      ? `${pct(ORGANIC_REACH_RATE)} of ${count(args.followers)} observed followers — promotion reach assumption, not measured traffic, and excludes any email list`
      : "No follower count available — modelled at the minimum testable launch size";
    return { key, label, value, tier: "assumed", source, needsConfirmation: !args.followers };
  }

  const nicheValue = niche?.overrides[key as keyof NonNullable<typeof niche>["overrides"]];
  if (nicheValue !== undefined) {
    return {
      key,
      label,
      value: clamp(key, nicheValue),
      tier: "assumed",
      source: `Starting point for ${niche!.label.toLowerCase()} — not a measured benchmark`,
      needsConfirmation: key === "front_end_price" || key === "backend_offer_price",
    };
  }

  return {
    key,
    label,
    value: DEFAULTS[key as keyof typeof DEFAULTS],
    tier: "assumed",
    source: "Working assumption",
    // Deal value and backend price are what the whole model swings on, so an
    // unconfirmed one always asks for a human before the report goes out.
    needsConfirmation: key === "front_end_price" || key === "backend_offer_price",
  };
}

/**
 * The §0 "known limits" list, derived from how the inputs actually resolved.
 *
 * Generated rather than written: if the deal value was assumed, the document says
 * so, every time, without anyone remembering to mention it.
 */
export function limitationsFrom(result: ResolveResult): string[] {
  const limits: string[] = [];
  const byKey = new Map(result.resolved.map((r) => [r.key, r]));

  const price = byKey.get("front_end_price");
  if (price && price.tier !== "observed" && price.tier !== "human") {
    limits.push(
      "No public price was found for the front-end offer. The deal value used here is an assumption and changes every revenue figure in this document.",
    );
  }
  if (byKey.get("backend_offer_price")?.tier === "assumed") {
    limits.push("The backend offer price is a working assumption. It is not drawn from anything published.");
  }
  if (byKey.get("paid_cost_per_registration")?.tier === "researched") {
    limits.push(
      "Cost per lead is a planning default, not this account's advertising data. No ad-account access was used.",
    );
  }
  limits.push(
    "Organic registration-page visitors are modelled from audience size, not measured. Followers are not traffic, no analytics access was used, and no email list is included in the model.",
  );
  limits.push("The scenarios are a decision model. They do not predict a guaranteed result.");
  return limits;
}
