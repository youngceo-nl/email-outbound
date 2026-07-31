import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseDutchMeetingDate, countMeetingsInMonth } from "./kpi-meetings";

describe("parseDutchMeetingDate", () => {
  it("parses a 'D month' Dutch label into a Date in the given year", () => {
    const date = parseDutchMeetingDate("18 juli", 2026);
    assert.ok(date);
    assert.equal(date?.getFullYear(), 2026);
    assert.equal(date?.getMonth(), 6); // July is month index 6
    assert.equal(date?.getDate(), 18);
  });

  it("returns null for an unparseable label", () => {
    assert.equal(parseDutchMeetingDate("not a date", 2026), null);
    assert.equal(parseDutchMeetingDate("", 2026), null);
  });
});

describe("countMeetingsInMonth", () => {
  it("counts only rows whose date falls in the given month", () => {
    const rows = [["18 juli"], ["2 juli"], ["5 augustus"], ["not a date"]];
    const count = countMeetingsInMonth(rows, new Date(2026, 6, 1)); // July 2026
    assert.equal(count, 2);
  });

  it("is 0 when nothing matches", () => {
    const rows = [["5 augustus"]];
    assert.equal(countMeetingsInMonth(rows, new Date(2026, 6, 1)), 0);
  });
});
