import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { computeStatus, buildKpiRow, computeTaskCompletion, computePositiveReplyRate, assembleKpiRows, type KpiRow } from "./kpi";

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

describe("computePositiveReplyRate", () => {
  it("divides positive replies by emails sent, as a percentage", () => {
    assert.equal(computePositiveReplyRate(15, 100), 15);
  });

  it("is null when no emails were sent today, not a misleading 0%", () => {
    assert.equal(computePositiveReplyRate(0, 0), null);
  });
});

describe("assembleKpiRows", () => {
  it("orders all 7 rows: 5 daily, then meetings booked, then task completion", () => {
    const daily = [
      buildKpiRow({ key: "leads_scraped", label: "Leads scraped", frequency: "daily", unit: "count", target: 500, targetLabel: "500", comparator: "at_least", actual: 500 }),
      buildKpiRow({ key: "leads_enriched", label: "Leads enriched", frequency: "daily", unit: "count", target: 100, targetLabel: "100", comparator: "at_least", actual: 100 }),
      buildKpiRow({ key: "emails_sent", label: "Emails sent", frequency: "daily", unit: "count", target: 100, targetLabel: "100", comparator: "at_least", actual: 100 }),
      buildKpiRow({ key: "first_response_time", label: "First response time", frequency: "daily", unit: "minutes", target: 120, targetLabel: "< 2 hours", comparator: "at_most", actual: 90 }),
      buildKpiRow({ key: "positive_reply_rate", label: "Positive reply rate", frequency: "daily", unit: "percent", target: 15, targetLabel: "15%", comparator: "at_least", actual: 15 }),
    ];
    const rows = assembleKpiRows(daily, 30);
    assert.deepEqual(rows.map((r) => r.key), [
      "leads_scraped", "leads_enriched", "emails_sent", "first_response_time",
      "positive_reply_rate", "meetings_booked", "task_completion",
    ]);
    assert.equal(rows[5].actual, 30);
    assert.equal(rows[5].frequency, "monthly");
    assert.equal(rows[6].actual, 100); // all 5 daily rows were "ok"
  });

  it("shows meetings booked as unknown when the sheet is unreachable", () => {
    const rows = assembleKpiRows([], null);
    const meetings = rows.find((r) => r.key === "meetings_booked")!;
    assert.equal(meetings.status, "unknown");
    assert.equal(meetings.actual, null);
  });
});
