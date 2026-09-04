import { describe, expect, it } from "vitest";
import { matchSession, parseSessionRows, reportedTimes, resolveStudio } from "./agent-session";

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
});
