/*
 * Opportunity model — matched to the Conversion Brands webinar funnel calculator
 * (webinar-funnel-calculator-eight.vercel.app), which is the tool the team
 * actually runs a P&L in.
 *
 * Three things were changed to match it, and each one mattered:
 *
 *   1. Expenses are named lines, either a fixed amount or a percentage of
 *      revenue — not a hardcoded commission rate plus a lump sum. The reference
 *      report's P&L has exactly three such lines ("Sales / partner commission
 *      17.5%", "Tools / software $400", "Fixed performance floor $3,000"), which
 *      is how we know that P&L came out of this calculator.
 *   2. Two scenarios, not three: a projected case and a worst case that differ
 *      only in CPL. That is precisely what the calculator's "Worst-Case CPL"
 *      stress test does.
 *   3. Cost per registration, CPA, ROAS and return on spend are outputs.
 *
 * The funnel chain itself already agreed with the calculator: paid leads are
 * ad spend / CPL, and the opt-in rate applies *only* to organic visitors because
 * CPL already prices in paid conversion efficiency.
 */

/** Bumped whenever a formula changes, and stored with every generated report. */
export const FORMULA_VERSION = "2.0";

/** A single P&L line. Mirrors the calculator's expense rows. */
export type ExpenseLine = {
  name: string;
  type: "fixed" | "percent_of_revenue";
  /** Dollars when fixed; a fraction (0.175 = 17.5%) when percent_of_revenue. */
  value: number;
};

export interface ScenarioInputs {
  organic_visitors: number;
  organic_optin_rate: number;
  ad_spend: number;
  /** Cost per lead. Paid registrations are ad_spend / this — opt-in does not apply. */
  paid_cost_per_registration: number;
  show_up_rate: number;
  /** The calculator's "Sign-Up Rate": live attendees who become deals. */
  front_end_purchase_rate: number;
  /** The calculator's "Average Deal Value". */
  front_end_price: number;
  expenses: ExpenseLine[];
  /** Not in the calculator; added because a webinar front end usually has one. */
  refund_rate?: number;
  /* Backend/ascension is deliberately outside the calculator's model — the
   * reference report treats the private offer as a stated assumption layered on
   * top of a front end that must work on its own. Kept optional so a report can
   * model it without implying the calculator produced it. */
  backend_ascension_rate?: number;
  backend_offer_price?: number;
}

export interface ScenarioOutputs {
  paid_registrations: number;
  organic_registrations: number;
  total_registrations: number;
  live_attendees: number;
  front_end_buyers: number;
  gross_front_end_revenue: number;
  refunds: number;
  net_front_end_revenue: number;
  /** Per-line expense amounts in dollars, in input order. */
  expense_amounts: Array<{ name: string; amount: number }>;
  total_expenses: number;
  front_end_net_profit: number;
  front_end_net_margin: number;
  /** Blended: ad spend over *all* registrations, organic included. */
  cost_per_registration: number;
  /** Ad spend per deal closed. */
  cpa: number;
  /** Revenue over ad spend. Blended, since organic feeds the same revenue. */
  roas: number;
  /** Net profit over everything spent, not just advertising. */
  return_on_total_spend: number;
  backend_clients: number;
  backend_gross_revenue: number;
  fixed_cost_base: number;
  contribution_per_buyer: number;
  break_even_buyers: number;
  break_even_purchase_rate: number;
}

/**
 * Division by zero has no single correct numeric answer, but letting it produce
 * NaN would poison every downstream formula silently. This mirrors the
 * mathematical limit instead: 0/0 is 0, and a nonzero numerator over zero
 * saturates to a signed Infinity — an explicit "unbounded" signal a caller can
 * detect, rather than a NaN spreading through the rest of the model.
 */
export function safeDivide(numerator: number, denominator: number): number {
  if (denominator !== 0) return numerator / denominator;
  if (numerator === 0) return 0;
  return numerator > 0 ? Infinity : -Infinity;
}

export function calculateScenario(inputs: ScenarioInputs): ScenarioOutputs {
  const refundRate = inputs.refund_rate ?? 0;

  // Paid and organic are separate paths: CPL already prices in paid conversion,
  // so applying the opt-in rate to paid traffic would discount it twice.
  const paid_registrations = safeDivide(inputs.ad_spend, inputs.paid_cost_per_registration);
  const organic_registrations = inputs.organic_visitors * inputs.organic_optin_rate;
  const total_registrations = paid_registrations + organic_registrations;

  const live_attendees = total_registrations * inputs.show_up_rate;
  const front_end_buyers = live_attendees * inputs.front_end_purchase_rate;
  const gross_front_end_revenue = front_end_buyers * inputs.front_end_price;
  const refunds = gross_front_end_revenue * refundRate;
  const net_front_end_revenue = gross_front_end_revenue - refunds;

  // Percentage lines are charged on net revenue, so a refunded sale does not
  // leave commission owed on money that came back.
  const expense_amounts = inputs.expenses.map((line) => ({
    name: line.name,
    amount: line.type === "fixed" ? line.value : net_front_end_revenue * line.value,
  }));
  const expenses_total = expense_amounts.reduce((sum, line) => sum + line.amount, 0);
  const total_expenses = inputs.ad_spend + expenses_total;

  const front_end_net_profit = net_front_end_revenue - total_expenses;
  const front_end_net_margin = safeDivide(front_end_net_profit, net_front_end_revenue);

  const cost_per_registration = safeDivide(inputs.ad_spend, total_registrations);
  const cpa = safeDivide(inputs.ad_spend, front_end_buyers);
  const roas = safeDivide(net_front_end_revenue, inputs.ad_spend);
  const return_on_total_spend = safeDivide(front_end_net_profit, total_expenses);

  const ascension = inputs.backend_ascension_rate ?? 0;
  const backend_clients = front_end_buyers * ascension;
  const backend_gross_revenue = backend_clients * (inputs.backend_offer_price ?? 0);

  // Break-even: fixed costs (ad spend included) divided by what one buyer
  // contributes after refunds and percentage-based lines.
  const fixed_lines = inputs.expenses
    .filter((line) => line.type === "fixed")
    .reduce((sum, line) => sum + line.value, 0);
  const percent_rate = inputs.expenses
    .filter((line) => line.type === "percent_of_revenue")
    .reduce((sum, line) => sum + line.value, 0);

  const fixed_cost_base = inputs.ad_spend + fixed_lines;
  const contribution_per_buyer = inputs.front_end_price * (1 - refundRate) * (1 - percent_rate);
  const break_even_buyers = safeDivide(fixed_cost_base, contribution_per_buyer);
  const break_even_purchase_rate = safeDivide(break_even_buyers, live_attendees);

  return {
    paid_registrations,
    organic_registrations,
    total_registrations,
    live_attendees,
    front_end_buyers,
    gross_front_end_revenue,
    refunds,
    net_front_end_revenue,
    expense_amounts,
    total_expenses,
    front_end_net_profit,
    front_end_net_margin,
    cost_per_registration,
    cpa,
    roas,
    return_on_total_spend,
    backend_clients,
    backend_gross_revenue,
    fixed_cost_base,
    contribution_per_buyer,
    break_even_buyers,
    break_even_purchase_rate,
  };
}

/** Round only for display; stored calculations keep full precision. */
export function roundForDisplay(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
