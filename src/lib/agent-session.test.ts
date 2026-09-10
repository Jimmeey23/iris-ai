import { describe, expect, it } from "vitest";
import { matchSession, parseSessionRows, reportedTimes, resolveStudio } from "./agent-session";
import { emptyState, markSlotSource, slotSource, valueToWords } from "./chat-engine";

const STUDIOS = [
  { id: 1, name: "Kwality House, Kemps Corner", code: "KC", city: "Mumbai", isHq: false },
  { id: 2, name: "Supreme HQ, Bandra", code: "BAN", city: "Mumbai", isHq: false },
  { id: 3, name: "Kenkere House, Indiranagar", code: "IND", city: "Bengaluru", isHq: false },
  { id: 4, name: "Support Centre", code: "HQ", city: "India", isHq: true },
];

describe("resolveStudio", () => {
  it("matches the exact recorded name", () => {
    expect(resolveStudio("Kwality House, Kemps Corner", STUDIOS)?.id).toBe(1);
  });

  it("matches the locality alone, as staff actually write it", () => {
    expect(resolveStudio("kemps corner", STUDIOS)?.id).toBe(1);
    expect(resolveStudio("Bandra", STUDIOS)?.id).toBe(2);
    expect(resolveStudio("indiranagar", STUDIOS)?.id).toBe(3);
  });

  it("tolerates a trailing city in brackets", () => {
    expect(resolveStudio("Kemps Corner (Mumbai)", STUDIOS)?.id).toBe(1);
  });

  it("matches on the studio code", () => {
    expect(resolveStudio("KC", STUDIOS)?.id).toBe(1);
  });

  it("does not guess from a city shared by several studios", () => {
    expect(resolveStudio("Mumbai", STUDIOS)).toBeNull();
  });

  it("returns null for a room inside a studio", () => {
    expect(resolveStudio("locker room", STUDIOS)).toBeNull();
    expect(resolveStudio("Studio 2", STUDIOS)).toBeNull();
  });

  it("returns null for nonsense", () => {
    expect(resolveStudio("", STUDIOS)).toBeNull();
    expect(resolveStudio("somewhere else entirely", STUDIOS)).toBeNull();
  });
});


const TIMETABLE = [
  "id=141066997 powerCycle Express · Fri, 4 Sept, 7:15 pm · Anisha Shah · Kwality House, Kemps Corner · 3/10 booked",
  "id=141066998 Barre 57 · Fri, 4 Sept, 10:00 am · Neha Rao · Kwality House, Kemps Corner · 8/12 booked",
  "id=141066999 Studio FIT · Fri, 4 Sept, 11:00 am · KV · Kwality House, Kemps Corner · 5/12 booked",
].join("\n");

describe("parseSessionRows", () => {
  it("reads id, label and start time from each row", () => {
    const rows = parseSessionRows(TIMETABLE);
    expect(rows).toHaveLength(3);
    expect(rows[0].id).toBe(141066997);
    expect(rows[0].time).toBe("7:15 pm");
    expect(rows[0].label).toContain("powerCycle Express");
  });

  it("ignores lines that are not sessions", () => {
    expect(parseSessionRows("no sessions matched")).toEqual([]);
  });
});

describe("reportedTimes", () => {
  it("normalises the ways staff write times", () => {
    expect(reportedTimes("BBB at 10 am, cycle at 10.30am and FIT at 11 am")).toEqual([
      "10:00 am",
      "10:30 am",
      "11:00 am",
    ]);
    expect(reportedTimes("the 7:15pm powerCycle")).toEqual(["7:15 pm"]);
  });
});

describe("matchSession", () => {
  it("matches on an unambiguous reported time", () => {
    expect(matchSession(parseSessionRows(TIMETABLE), "the 7:15pm powerCycle was late")?.id).toBe(
      141066997,
    );
  });

  it("takes the only row when the reporter gave no time", () => {
    const one = parseSessionRows(TIMETABLE.split("\n")[0]);
    expect(matchSession(one, "the cycle class was a mess")?.id).toBe(141066997);
  });

  it("refuses when several reported times could apply", () => {
    expect(matchSession(parseSessionRows(TIMETABLE), "10 am BBB and 11 am FIT were hit")).toBeNull();
  });

  it("refuses when no row matches the reported time", () => {
    expect(matchSession(parseSessionRows(TIMETABLE), "the 6:00 am class")).toBeNull();
  });

  it("refuses to guess from a whole timetable with no time given", () => {
    expect(matchSession(parseSessionRows(TIMETABLE), "a class today was bad")).toBeNull();
  });

  it("handles an empty result", () => {
    expect(matchSession([], "the 7:15pm powerCycle")).toBeNull();
  });

  it("only binds rows from the reported day when the day is known", () => {
    const rows = parseSessionRows(TIMETABLE); // all dated Fri, 4 Sept
    // The same clock time a week earlier must not bind to these rows.
    expect(matchSession(rows, "the 7:15pm powerCycle was late", "2026-08-28")).toBeNull();
    // The right day keeps the time-based match.
    expect(matchSession(rows, "the 7:15pm powerCycle was late", "2026-09-04")?.id).toBe(141066997);
  });
});

describe("option vocabulary — every click speaks words the agent can read", () => {
  const ctx = { studios: STUDIOS };

  // Every option value the UI can render, from every engine surface.
  const ANSWER_VALUES = [
    "ans:Yes — needs immediate action",
    "ans:impact|Several members affected",
    "ans:resolved|Yes — resolved",
    "studio:1", "studio:none",
    "member:123|Priya Shah",
    "session:141066997|Barre 57 · Fri, 4 Sept, 10:00 am|Neha Rao",
    "trainer:Neha", "membership:20-class pack", "mem:Annual membership",
    "for:On behalf of a member",
    "class:Barre 57", "loc:Locker room", "sys:POS / card machine",
    "when:Just now", "impact:safety", "risk:yes", "risk:no",
    "freq:First time", "cat:Class Experience", "sub:Audio Issues",
    "skip", "browse", "unknown", "showall",
    "confirm:yes", "confirm:alt:0", "prio:High", "edit", "edit:studio",
  ];

  it("translates every answer value into non-empty words", () => {
    for (const value of ANSWER_VALUES) {
      const words = valueToWords(value, ctx);
      expect(words, `value ${value} produced no words`).not.toBe("");
    }
  });

  it("produces plain-language words, never raw ids", () => {
    for (const value of ANSWER_VALUES) {
      expect(valueToWords(value, ctx)).not.toMatch(/^[a-z]+:/);
    }
  });

  it("maps the tapped studio to the real studio name", () => {
    expect(valueToWords("studio:1", ctx)).toContain("Kwality House");
    expect(valueToWords("studio:none", ctx)).toContain("not studio specific");
  });

  it("leaves deterministic commands wordless — they never reach the agent", () => {
    for (const value of ["approve", "restart", "new", "undo", ""]) {
      expect(valueToWords(value, ctx)).toBe("");
    }
  });
});

describe("slot provenance", () => {
  it("records and reads back sources", () => {
    const s = emptyState();
    expect(slotSource(s, "studio")).toBeUndefined();
    markSlotSource(s, "studio", "user");
    expect(slotSource(s, "studio")).toBe("user");
    markSlotSource(s, ["classInfo", "trainerName"], "context");
    expect(slotSource(s, "classInfo")).toBe("context");
    expect(slotSource(s, "trainerName")).toBe("context");
  });
});
