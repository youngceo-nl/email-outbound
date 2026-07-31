import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { inclusiveRangeDays, rangeLabel, resolveDateRange, type ResolvedRange } from "./date-range";

const range = (start: string, end: string, preset: ResolvedRange["preset"] = null): ResolvedRange => ({
  start: new Date(start), end: new Date(end), preset,
});

describe("inclusiveRangeDays", () => {
  it("counts both calendar endpoints", () => {
    assert.equal(inclusiveRangeDays(range("2026-07-01T00:00:00", "2026-07-07T23:59:59")), 7);
  });

  it("falls back to one day for an unresolved empty range", () => {
    assert.equal(inclusiveRangeDays({ start: null, end: null, preset: "all" }), 1);
  });

  it("does not count the local timezone offset as an extra day", () => {
    assert.equal(inclusiveRangeDays(resolveDateRange({ range: "7d" })), 7);
  });
});

describe("rangeLabel", () => {
  it("uses preset labels", () => {
    assert.equal(rangeLabel(range("2026-07-25", "2026-07-31", "7d")), "7 days");
  });

  it("uses ISO dates for a custom range", () => {
    assert.equal(rangeLabel(resolveDateRange({ start: "2026-07-01", end: "2026-07-31" })), "2026-07-01 - 2026-07-31");
  });
});
