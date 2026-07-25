import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { frontEndPriceFrom, parsePrice } from "./price";
import { limitationsFrom, resolveAssumptions, type ResolveArgs } from "./resolve";
import { deriveOrganicVisitors, matchNiche } from "./defaults";
import { calculateScenario } from "../calculations/formulas";

/*
 *   npx tsx --test lib/report/assumptions/resolve.test.ts
 */

const BASE: ResolveArgs = {
  followers: 191_000,
  niche: null,
  businessModel: null,
  funnelPrice: null,
  funnelPriceObservedAt: null,
  funnelPlatform: null,
};

describe("parsePrice", () => {
  const cases: Array<[string, number, string, string]> = [
    ["$997", 997, "USD", "one_time"],
    ["997", 997, "USD", "one_time"],
    ["$1,997.00", 1997, "USD", "one_time"],
    ["$1.5k", 1500, "USD", "one_time"],
    ["€1,200", 1200, "EUR", "one_time"],
    ["£49/mo", 49, "GBP", "monthly"],
    ["$97 per month", 97, "USD", "monthly"],
    ["$1,200/year", 1200, "USD", "annual"],
    ["USD 497", 497, "USD", "one_time"],
    ["A$2,500 one-time", 2500, "AUD", "one_time"],
  ];

  for (const [raw, amount, currency, period] of cases) {
    it(`reads ${raw}`, () => {
      const result = parsePrice(raw);
      assert.ok(result.ok, `failed to parse ${raw}`);
      assert.equal(result.price.amount, amount);
      assert.equal(result.price.currency, currency);
      assert.equal(result.price.period, period);
    });
  }

  it("takes the highest of several figures and flags it", () => {
    const result = parsePrice("$97 today, normally $497");
    assert.ok(result.ok);
    assert.equal(result.price.amount, 497);
    assert.equal(result.price.ambiguous, true);
  });

  it("flags a payment plan rather than treating an instalment as the price", () => {
    const result = parsePrice("3 payments of $499");
    assert.ok(result.ok);
    assert.equal(result.price.ambiguous, true);
  });

  it("distinguishes a call-gated funnel from a page it could not read", () => {
    assert.deepEqual(parsePrice("Book a call for pricing"), { ok: false, reason: "call_for_price" });
    assert.deepEqual(parsePrice("Transform your life"), { ok: false, reason: "no_number" });
    assert.deepEqual(parsePrice(""), { ok: false, reason: "empty" });
    assert.deepEqual(parsePrice(null), { ok: false, reason: "empty" });
  });

  it("rejects figures outside a plausible offer range", () => {
    assert.deepEqual(parsePrice("0.5"), { ok: false, reason: "implausible" });
    assert.deepEqual(parsePrice("$9,999,999"), { ok: false, reason: "implausible" });
  });
});

describe("frontEndPriceFrom", () => {
  it("annualises a monthly price but demands confirmation", () => {
    const parsed = parsePrice("$97/mo");
    assert.ok(parsed.ok);
    const front = frontEndPriceFrom(parsed.price);
    // A $97/mo community is not a $97 front-end ticket. 12 months is a starting
    // point for the strategist, never something the report asserts alone.
    assert.equal(front.amount, 1164);
    assert.equal(front.needsConfirmation, true);
  });

  it("passes a clean one-time price through without confirmation", () => {
    const parsed = parsePrice("$997");
    assert.ok(parsed.ok);
    assert.deepEqual(
      { amount: frontEndPriceFrom(parsed.price).amount, confirm: frontEndPriceFrom(parsed.price).needsConfirmation },
      { amount: 997, confirm: false },
    );
  });
});

describe("cascade precedence", () => {
  it("falls back to the ladder and labels it an assumption", () => {
    const r = resolveAssumptions(BASE);
    const price = r.resolved.find((x) => x.key === "front_end_price")!;
    assert.equal(price.value, 2000);
    assert.equal(price.tier, "assumed");
    assert.ok(r.needsConfirmation.includes("front_end_price"));
  });

  it("prefers a scraped price over the ladder and dates the observation", () => {
    const r = resolveAssumptions({
      ...BASE,
      funnelPrice: "$997",
      funnelPriceObservedAt: "2026-07-25T00:00:00Z",
      funnelPlatform: "skool",
    });
    const price = r.resolved.find((x) => x.key === "front_end_price")!;
    assert.equal(price.value, 997);
    assert.equal(price.tier, "observed");
    assert.match(price.source, /skool/);
    assert.match(price.source, /25 Jul 2026/);
  });

  it("lets a human override beat a scraped price", () => {
    const r = resolveAssumptions({
      ...BASE,
      funnelPrice: "$997",
      overrides: { front_end_price: 3000 },
      confirmedBy: "Julian",
    });
    const price = r.resolved.find((x) => x.key === "front_end_price")!;
    assert.equal(price.value, 3000);
    assert.equal(price.tier, "human");
    assert.match(price.source, /Julian/);
    assert.equal(price.needsConfirmation, false);
  });

  it("claims the researched tier for CPL only while it is the unscaled default", () => {
    const plain = resolveAssumptions(BASE).resolved.find((x) => x.key === "paid_cost_per_registration")!;
    assert.equal(plain.tier, "researched");

    // The health/fitness profile scales CPL up, so the value is no longer purely
    // the cited default and must not keep claiming that tier.
    const adjusted = resolveAssumptions({ ...BASE, niche: "breathwork and wellness coaching" }).resolved.find(
      (x) => x.key === "paid_cost_per_registration",
    )!;
    assert.equal(adjusted.value, 24); // 15 x 1.6
    assert.equal(adjusted.tier, "assumed");
    assert.match(adjusted.source, /our estimate/);
  });

  it("never reports a scraped figure for something that cannot be scraped", () => {
    const r = resolveAssumptions({ ...BASE, funnelPrice: "$997" });
    for (const input of r.resolved) {
      if (input.key === "front_end_price") continue;
      assert.notEqual(input.tier, "observed", `${input.key} claimed to be observed`);
    }
  });
});

describe("two-column model", () => {
  it("differs between the columns only in cost per lead", () => {
    const r = resolveAssumptions(BASE);
    const { projected, worst } = r.inputs;

    assert.notEqual(projected.paid_cost_per_registration, worst.paid_cost_per_registration);
    // Everything else must be identical — the calculator's worst case is a CPL
    // stress test, not a different set of assumptions.
    const { paid_cost_per_registration: _p, ...projectedRest } = projected;
    const { paid_cost_per_registration: _w, ...worstRest } = worst;
    assert.deepEqual(projectedRest, worstRest);
  });

  it("uses the calculator's own CPL defaults", () => {
    const r = resolveAssumptions(BASE);
    assert.equal(r.inputs.projected.paid_cost_per_registration, 15);
    assert.equal(r.inputs.worst.paid_cost_per_registration, 50);
  });

  it("scales both CPLs by the niche multiplier instead of writing an absolute value", () => {
    /*
     * The bug this replaces: the wellness profile set CPL to an absolute $45 — a
     * worst-case figure — so the *projected* column silently ran worst-case
     * traffic economics and every wellness projection came out roughly 40% low.
     * A multiplier keeps the projected/worst relationship intact.
     */
    const r = resolveAssumptions({ ...BASE, niche: "breathwork and nervous system coaching" });
    assert.equal(r.inputs.projected.paid_cost_per_registration, 24); // 15 x 1.6
    assert.equal(r.inputs.worst.paid_cost_per_registration, 80); // 50 x 1.6
    assert.ok(r.inputs.projected.paid_cost_per_registration < r.inputs.worst.paid_cost_per_registration);
  });

  it("applies a human override to both columns", () => {
    const r = resolveAssumptions({ ...BASE, overrides: { front_end_price: 2500 } });
    assert.equal(r.inputs.projected.front_end_price, 2500);
    assert.equal(r.inputs.worst.front_end_price, 2500);
  });

  it("clamps an overridden rate to 100%", () => {
    const r = resolveAssumptions({ ...BASE, overrides: { show_up_rate: 1.4 } });
    assert.equal(r.inputs.projected.show_up_rate, 1);
  });

  it("carries the standard expense lines into both scenarios", () => {
    const r = resolveAssumptions(BASE);
    assert.deepEqual(
      r.expenses.map((line) => [line.name, line.type]),
      [
        ["Sales / partner commission", "percent_of_revenue"],
        ["Tools / software", "fixed"],
        ["Fixed performance floor", "fixed"],
      ],
    );
    assert.equal(r.inputs.projected.expenses, r.expenses);
    assert.equal(r.inputs.worst.expenses, r.expenses);
  });

  it("lets a caller replace the expense lines entirely", () => {
    const expenses = [{ name: "Affiliate split", type: "percent_of_revenue" as const, value: 0.3 }];
    const r = resolveAssumptions({ ...BASE, expenses });
    assert.deepEqual(r.inputs.projected.expenses, expenses);
  });

  it("produces scenarios that run through the calculator without NaN", () => {
    const r = resolveAssumptions({ ...BASE, niche: "business coaching" });
    for (const key of ["projected", "worst"] as const) {
      const out = calculateScenario(r.inputs[key]);
      for (const [field, value] of Object.entries(out)) {
        if (typeof value !== "number") continue;
        assert.ok(!Number.isNaN(value), `${key}.${field} is NaN`);
      }
      assert.ok(out.gross_front_end_revenue > 0, `${key} produced no revenue`);
    }
  });
});

describe("organic visitors", () => {
  it("models traffic as a share of audience, not the audience itself", () => {
    // The reference is emphatic that followers are not traffic. 1.5% of 191k
    // lands near its hand-picked 2,500.
    assert.equal(deriveOrganicVisitors(191_000), 3820); // 2% of 191k

  });

  it("floors a tiny or unknown audience at a testable launch size", () => {
    assert.equal(deriveOrganicVisitors(100), 300);
    assert.equal(deriveOrganicVisitors(null), 300);
    assert.equal(deriveOrganicVisitors(0), 300);
  });

  it("says both halves of where the visitor figure came from", () => {
    const r = resolveAssumptions(BASE);
    const visitors = r.resolved.find((x) => x.key === "organic_visitors")!;
    assert.equal(visitors.tier, "assumed");
    assert.match(visitors.source, /observed followers/);
    assert.match(visitors.source, /not measured traffic/);
  });

  it("asks for confirmation when there is no follower count at all", () => {
    const r = resolveAssumptions({ ...BASE, followers: null });
    assert.ok(r.needsConfirmation.includes("organic_visitors"));
  });
});

describe("niche matching", () => {
  it("matches on niche or business model text", () => {
    assert.equal(matchNiche("business coaching", null)?.id, "coaching_consulting");
    assert.equal(matchNiche(null, "SMMA agency")?.id, "agency_service");
    assert.equal(matchNiche("paid skool community", null)?.id, "course_community");
    assert.equal(matchNiche("gibberish", null), null);
  });

  it("warns when a webinar model is a poor fit for the business", () => {
    const r = resolveAssumptions({ ...BASE, niche: "shopify dropshipping store" });
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /rarely convert/);
  });

  it("warns that a call-gated funnel changes the recommendation", () => {
    const r = resolveAssumptions({ ...BASE, funnelPrice: "Apply to work with me" });
    assert.match(r.warnings.join(" "), /book a call/i);
  });
});

describe("generated limitations", () => {
  it("admits an assumed price when nothing was scraped", () => {
    const limits = limitationsFrom(resolveAssumptions(BASE));
    assert.match(limits.join("\n"), /No public price was found/);
    assert.match(limits.join("\n"), /not this account's advertising data/);
    assert.match(limits.join("\n"), /Followers are not traffic/);
  });

  it("drops the price caveat once the price is actually observed", () => {
    const limits = limitationsFrom(resolveAssumptions({ ...BASE, funnelPrice: "$997" }));
    assert.doesNotMatch(limits.join("\n"), /No public price was found/);
  });

  it("always states that the scenarios are a model", () => {
    assert.match(limitationsFrom(resolveAssumptions(BASE)).join("\n"), /do not predict a guaranteed result/);
  });
});
