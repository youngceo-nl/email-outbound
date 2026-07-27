import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLadder,
  classifyRung,
  routeLadder,
  type CapturedPrice,
  type PriceBand,
} from "./ladder";

/*
 * The routing brain. These pin the five report shapes to the evidence states
 * that must produce them — including the exact failure the v3 spec documents:
 * a $12/mo app subscription treated as the offer a webinar sells.
 */

const BAND: PriceBand = { mid: 997, high: 1997, source: "test band", tier: "assumed" };

function captured(raws: string[]): CapturedPrice[] {
  return raws.map((raw) => ({ raw, label: null, url: null, source: "test" }));
}

describe("rung classification", () => {
  it("puts capture products low, webinar tickets mid, application offers high", () => {
    assert.equal(classifyRung(12), "low");
    assert.equal(classifyRung(144), "low"); // $12/mo annualized
    assert.equal(classifyRung(199), "low");
    assert.equal(classifyRung(200), "mid");
    assert.equal(classifyRung(497), "mid");
    assert.equal(classifyRung(2999), "mid");
    assert.equal(classifyRung(3000), "high");
    assert.equal(classifyRung(20000), "high");
  });

  it("judges a recurring price on its checkout transaction, keeping the annualized value as context", () => {
    // A $97/mo community collects $97 at checkout — capture-product math, no
    // matter that it is a $1,164/yr relationship. Both numbers are kept.
    const ladder = buildLadder(captured(["$97/mo"]));
    assert.equal(ladder.rungs.low.length, 1);
    assert.equal(ladder.rungs.low[0].amount, 97);
    assert.equal(ladder.rungs.low[0].annualized, 1164);
    // …while a $297/mo coaching program is a mid-ticket checkout.
    const coaching = buildLadder(captured(["$297/mo"]));
    assert.equal(coaching.rungs.mid.length, 1);
  });

  it("reads a billing period from surrounding context when the price string lacks one", () => {
    const ladder = buildLadder([
      { raw: "$97", label: null, url: null, source: "test", context: "membership billed monthly, cancel anytime" },
    ]);
    assert.equal(ladder.rungs.low[0].period, "monthly");
    assert.equal(ladder.rungs.low[0].annualized, 1164);
  });

  it("dedupes the same price seen by two extraction passes", () => {
    const ladder = buildLadder(captured(["$497", "$497", "$ 497"]));
    assert.equal(ladder.rungs.mid.length, 1);
  });

  it("keeps unparseable captures visible instead of dropping them", () => {
    const ladder = buildLadder(captured(["contact us for pricing"]));
    assert.equal(ladder.unparsed.length, 1);
    assert.deepEqual(ladder.missing, ["low", "mid", "high"]);
  });
});

describe("routing — the five report shapes", () => {
  it("the Rachidi case: a $12/mo app alone routes to missing_mid, never standard", () => {
    const ladder = buildLadder(captured(["$12/mo"]));
    const decision = routeLadder(ladder, BAND);
    assert.equal(decision.route, "missing_mid");
    assert.equal(decision.modeledEntry, null);
  });

  it("a mid-ticket in band routes standard and models that entry", () => {
    const ladder = buildLadder(captured(["$1,497"]));
    const decision = routeLadder(ladder, BAND);
    assert.equal(decision.route, "standard");
    assert.equal(decision.modeledEntry?.amount, 1497);
  });

  it("a mid-ticket far below band routes to repricing", () => {
    // Band mid 997 → threshold 498.50. $297 is a mid-rung price (>$200) that a
    // category selling at ~$997 has left badly underpriced.
    const ladder = buildLadder(captured(["$297"]));
    const decision = routeLadder(ladder, BAND);
    assert.equal(decision.route, "repricing");
    assert.equal(decision.modeledEntry?.amount, 297);
  });

  it("only a high-ticket routes to application_funnel", () => {
    const ladder = buildLadder(captured(["$5,000"]));
    assert.equal(routeLadder(ladder, BAND).route, "application_funnel");
  });

  it("high + low with no mid still surfaces the missing mid", () => {
    const ladder = buildLadder(captured(["$12/mo", "$5,000"]));
    assert.equal(routeLadder(ladder, BAND).route, "missing_mid");
  });

  it("nothing found routes to discovery", () => {
    assert.equal(routeLadder(buildLadder([]), BAND).route, "discovery");
  });

  it("a full ladder routes standard on the mid rung", () => {
    const ladder = buildLadder(captured(["$29/mo", "$997", "$8,000"]));
    const decision = routeLadder(ladder, BAND);
    assert.equal(decision.route, "standard");
    assert.equal(decision.modeledEntry?.amount, 997);
    assert.deepEqual(ladder.missing, []);
  });
});

describe("confidence", () => {
  it("is high with two clean parses, medium with one, low with none", () => {
    assert.equal(buildLadder(captured(["$997", "$29/mo"])).confidence, "high");
    assert.equal(buildLadder(captured(["$997"])).confidence, "medium");
    assert.equal(buildLadder([]).confidence, "low");
  });

  it("an ambiguous parse caps confidence at medium", () => {
    // Two figures in one string — the parser flags it, so the ladder cannot
    // claim high confidence off the back of a guess.
    const ladder = buildLadder(captured(["$997 or 3 payments of $399", "$29/mo"]));
    assert.equal(ladder.confidence, "medium");
  });
});
