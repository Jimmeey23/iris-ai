import { describe, expect, it } from "vitest";
import { istDate, resolveWhenToDate, rowDateToIso } from "./time";

// A fixed instant inside the 00:00–05:30 IST window, where UTC "today" and IST
// "today" disagree: 2026-09-10T01:30:00+05:30 === 2026-09-09T20:00:00Z.
const PRE_DAWN = new Date("2026-09-09T20:00:00.000Z");
const NOON = new Date("2026-09-10T06:30:00.000Z"); // 12:00 IST

describe("istDate", () => {
  it("stays on the IST calendar when UTC has rolled to the previous day", () => {
    expect(istDate(0, PRE_DAWN)).toBe("2026-09-10");
    expect(new Date(PRE_DAWN).toISOString().slice(0, 10)).toBe("2026-09-09");
  });

  it("offsets by whole days on the IST calendar", () => {
    expect(istDate(-1, PRE_DAWN)).toBe("2026-09-09");
    expect(istDate(1, NOON)).toBe("2026-09-11");
  });
});

describe("resolveWhenToDate", () => {
  it("maps today-phrases to the IST today", () => {
    expect(resolveWhenToDate("Just now", PRE_DAWN)).toBe("2026-09-10");
    expect(resolveWhenToDate("Earlier today, 10:00-11:30 am", NOON)).toBe("2026-09-10");
    expect(resolveWhenToDate("this morning", PRE_DAWN)).toBe("2026-09-10");
  });

  it("maps yesterday and last night to the IST yesterday", () => {
    expect(resolveWhenToDate("Yesterday", PRE_DAWN)).toBe("2026-09-09");
    expect(resolveWhenToDate("last night", NOON)).toBe("2026-09-09");
  });

  it("parses an explicit day-month phrase to the nearest year", () => {
    expect(resolveWhenToDate("3 Sept", NOON)).toMatch(/-09-03$/);
    expect(resolveWhenToDate("September 3rd", NOON)).toMatch(/-09-03$/);
  });

  it("leaves vague phrases unresolved so callers treat them as unknown", () => {
    expect(resolveWhenToDate("Earlier this week", NOON)).toBeUndefined();
    expect(resolveWhenToDate("Ongoing / recurring", NOON)).toBeUndefined();
    expect(resolveWhenToDate("Not specified", NOON)).toBeUndefined();
    expect(resolveWhenToDate(undefined, NOON)).toBeUndefined();
  });
});

describe("rowDateToIso", () => {
  it("reads the date out of a Momence lookup row label", () => {
    expect(rowDateToIso("powerCycle Express · Thu, 10 Sept, 7:15 pm · Anisha Shah", NOON)).toMatch(/-09-10$/);
    expect(rowDateToIso("Barre 57 · Fri, 4 Sept, 10:00 am · Neha Rao", NOON)).toMatch(/-09-04$/);
  });

  it("returns undefined when the label carries no date", () => {
    expect(rowDateToIso("id=123 Barre 57 · 10:00 am", NOON)).toBeUndefined();
  });
});
