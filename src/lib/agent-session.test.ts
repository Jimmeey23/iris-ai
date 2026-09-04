import { describe, expect, it } from "vitest";
import { resolveStudio } from "./agent-session";

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
