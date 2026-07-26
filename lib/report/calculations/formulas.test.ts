import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { calculateScenario, roundForDisplay, safeDivide } from "./formulas";
import { AARON_INPUTS, AARON_STRONG, aaronScenarios } from "../fixtures/aaron";
import { count, pct, usd } from "../format";

/*
 *   npx tsx --test lib/report/calculations/formulas.test.ts
 *
 * Pinned against the published reference report, not against the implementation.
 * If one fails, the question is "what changed about what we tell prospects", not
 * "which number should I update".
 */

describe("the reference report's projected case", () => {
  const s = aaronScenarios().projected;

  it("walks the funnel to the reference's figures", () => {
    // Paid leads are ad spend / CPL; the opt-in rate applies only to organic
    // visitors, because CPL already prices in paid conversion efficiency.
    assert.equal(s.paid_registrations, 100); // $2,500 / $25
    assert.equal(s.organic_registrations, 625); // 2,500 visitors x 25%
    assert.equal(s.total_registrations, 725);
    assert.equal(count(s.live_attendees), "181"); // 181.25 at full precision
    assert.equal(count(s.front_end_buyers), "27"); // 27.1875 at full precision
  });

  it("keeps full precision through revenue rather than multiplying a rounded buyer count", () => {
    // 27 x $997 = $26,919, but the reference says $27,106 because the real buyer
    // count is 27.1875. This is why rounding happens only at display.
    assert.equal(roundForDisplay(s.gross_front_end_revenue), 27105.94);
    assert.equal(usd(s.gross_front_end_revenue), "$27,106");
    assert.notEqual(usd(s.gross_front_end_revenue), "$26,919");
  });

  it("charges each expense line the way the calculator does", () => {
    assert.deepEqual(
      s.expense_amounts.map((line) => [line.name, roundForDisplay(line.amount)]),
      [
        ["Sales / partner commission", 4743.54], // 17.5% of net revenue
        ["Tools / software", 400],
        ["Fixed performance floor", 3000],
      ],
    );
    // Ad spend is not an expense *line* — it is its own input, and the calculator
    // adds it separately. Double-counting it here would be easy and silent.
    assert.equal(roundForDisplay(s.total_expenses), 10643.54);
  });

  it("matches the reference P&L's profit and margin", () => {
    assert.equal(roundForDisplay(s.front_end_net_profit), 16462.4);
    assert.equal(pct(s.front_end_net_margin), "60.7%");
  });

  it("reproduces the reference's stated 10.84x on ad spend", () => {
    // The reference prints this figure and notes it reads as a blended campaign
    // ratio rather than pure paid ROAS, because organic feeds the same revenue.
    assert.equal(roundForDisplay(s.roas, 2), 10.84);
  });

  it("computes the calculator's efficiency outputs", () => {
    assert.equal(roundForDisplay(s.cost_per_registration), 3.45); // $2,500 / 725 blended
    assert.equal(roundForDisplay(s.cpa), 91.95); // $2,500 / 27.1875 sign-ups
    assert.equal(roundForDisplay(s.return_on_total_spend, 3), 1.547); // profit / everything spent
  });

  it("puts break-even at the reference's ~4% sign-up rate", () => {
    assert.equal(pct(s.break_even_purchase_rate), "4%");
    assert.equal(roundForDisplay(s.break_even_purchase_rate * 100), 3.96);
  });

  it("reports backend clients as the fraction they are, not a promised client", () => {
    // The reference is explicit that 2-3% of 27 buyers is "zero in some launches
    // and one in others" — never one guaranteed client per launch.
    assert.ok(s.backend_clients < 1, `expected <1 backend client, got ${s.backend_clients}`);
    assert.equal(roundForDisplay(s.backend_clients), 0.68);
  });
});

describe("the reference report's other two columns", () => {
  it("matches the worst case", () => {
    const s = aaronScenarios().worst;
    assert.equal(count(s.total_registrations), "356");
    assert.equal(count(s.live_attendees), "89");
    assert.equal(count(s.front_end_buyers), "9");

    /*
     * Documented divergence, not a bug on our side.
     *
     * The reference prints $8,863 here. The arithmetic gives $8,862.22:
     * (2500/45 + 1500*0.20) * 0.25 * 0.10 * 997 = 8.8889 buyers * 997. Reaching
     * $8,863 needs a value at or above $8,862.50, which no ordering of this chain
     * produces — so the published figure carries a rounding artifact. This test
     * records it so nobody "fixes" the calculator to match a typo.
     */
    assert.equal(roundForDisplay(s.gross_front_end_revenue), 8862.22);
    assert.equal(usd(s.gross_front_end_revenue), "$8,862");
  });

  it("matches the strong column the two-scenario model no longer renders", () => {
    // Kept asserted because it is published: if the calculator ever stops
    // reproducing it, something in the chain has drifted.
    const s = calculateScenario(AARON_STRONG);
    assert.equal(count(s.total_registrations), "1,650");
    assert.equal(count(s.live_attendees), "578");
    assert.equal(count(s.front_end_buyers), "104");
    assert.equal(usd(s.gross_front_end_revenue), "$103,638");
  });
});

describe("guard rails", () => {
  it("treats division by zero as a limit rather than poisoning the model with NaN", () => {
    assert.equal(safeDivide(0, 0), 0);
    assert.equal(safeDivide(5, 0), Infinity);
    assert.equal(safeDivide(-5, 0), -Infinity);
  });

  it("survives a zero-traffic scenario without producing NaN anywhere", () => {
    // A lead with no scraped traffic signal is a real case, and every figure in
    // the document reads off this object.
    const zeroed = calculateScenario({ ...AARON_INPUTS.projected, ad_spend: 0, organic_visitors: 0 });
    for (const [key, value] of Object.entries(zeroed)) {
      if (typeof value !== "number") continue;
      assert.ok(!Number.isNaN(value), `${key} is NaN`);
    }
    assert.equal(zeroed.total_registrations, 0);
    assert.equal(zeroed.gross_front_end_revenue, 0);
  });

  it("charges percentage lines on net revenue so refunds don't carry commission", () => {
    const withRefunds = calculateScenario({ ...AARON_INPUTS.projected, refund_rate: 0.1 });
    const base = calculateScenario(AARON_INPUTS.projected);

    const commission = (o: typeof base) => o.expense_amounts.find((l) => l.name.includes("commission"))!.amount;
    assert.ok(commission(withRefunds) < commission(base));
    assert.equal(roundForDisplay(withRefunds.net_front_end_revenue), roundForDisplay(base.gross_front_end_revenue * 0.9));
    // Fixed lines are unaffected by refunds — that is what makes them fixed.
    const tools = (o: typeof base) => o.expense_amounts.find((l) => l.name === "Tools / software")!.amount;
    assert.equal(tools(withRefunds), tools(base));
  });

  it("handles an all-fixed expense set with no percentage line", () => {
    const s = calculateScenario({
      ...AARON_INPUTS.projected,
      expenses: [{ name: "Tools", type: "fixed", value: 500 }],
    });
    assert.equal(roundForDisplay(s.total_expenses), 3000); // $2,500 ad spend + $500
    // With no percentage line, a buyer contributes the full ticket price.
    assert.equal(s.contribution_per_buyer, AARON_INPUTS.projected.front_end_price);
  });

  it("handles no expense lines at all", () => {
    const s = calculateScenario({ ...AARON_INPUTS.projected, expenses: [] });
    assert.deepEqual(s.expense_amounts, []);
    assert.equal(s.total_expenses, AARON_INPUTS.projected.ad_spend);
  });
});
