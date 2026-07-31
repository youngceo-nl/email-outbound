import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { computeStatus, buildKpiRow, computeTaskCompletion, type KpiRow } from "./kpi";

describe("computeStatus", () => {
  it("is unknown when actual is null", () => {
    assert.equal(computeStatus(null, 500, "at_least"), "unknown");
  });

  it("is ok when an at_least target is met or exceeded", () => {
    assert.equal(computeStatus(500, 500, "at_least"), "ok");
    assert.equal(computeStatus(600, 500, "at_least"), "ok");
  });

  it("is below when an at_least target is missed", () => {
    assert.equal(computeStatus(499, 500, "at_least"), "below");
  });

  it("is ok when an at_most target is met or undercut", () => {
    assert.equal(computeStatus(120, 120, "at_most"), "ok");
    assert.equal(computeStatus(90, 120, "at_most"), "ok");
  });

  it("is below when an at_most target is exceeded", () => {
    assert.equal(computeStatus(121, 120, "at_most"), "below");
  });
});

describe("buildKpiRow", () => {
  it("attaches the computed status to the row", () => {
    const row = buildKpiRow({
      key: "leads_scraped",
      label: "Leads scraped",
      frequency: "daily",
      unit: "count",
      target: 500,
      targetLabel: "500",
      comparator: "at_least",
      actual: 320,
    });
    assert.equal(row.status, "below");
    assert.equal(row.key, "leads_scraped");
    assert.equal(row.actual, 320);
  });
});

describe("computeTaskCompletion", () => {
  const row = (status: KpiRow["status"]): KpiRow => ({
    key: "x", label: "x", frequency: "daily", unit: "count", target: 1, targetLabel: "1", actual: 1, status,
  });

  it("is 100% ok when every resolved row is ok", () => {
    const result = computeTaskCompletion([row("ok"), row("ok"), row("ok")]);
    assert.equal(result.actual, 100);
    assert.equal(result.status, "ok");
  });

  it("is a fraction below 100 when some rows are below target", () => {
    const result = computeTaskCompletion([row("ok"), row("ok"), row("below"), row("below")]);
    assert.equal(result.actual, 50);
    assert.equal(result.status, "below");
  });

  it("excludes unknown rows from both numerator and denominator", () => {
    const result = computeTaskCompletion([row("ok"), row("ok"), row("unknown")]);
    assert.equal(result.actual, 100);
    assert.equal(result.status, "ok");
  });

  it("is unknown when every row is unknown", () => {
    const result = computeTaskCompletion([row("unknown"), row("unknown")]);
    assert.equal(result.actual, null);
    assert.equal(result.status, "unknown");
  });
});
