import { describe, expect, it } from "vitest";
import { classify, extractPerson } from "./ai";

describe("extractPerson", () => {
  it("reads a labelled trainer", () => {
    expect(extractPerson("trainer Neha was 10 minutes late")).toBe("Neha");
  });

  it("reads a trailing label", () => {
    expect(extractPerson("Anjali the instructor swapped the playlist")).toBe("Anjali");
  });

  it("reads a lowercase handle before a teaching verb", () => {
    expect(extractPerson("1 client showed up for cycle - kv conducted the class")).toBe("KV");
  });

  it("does not treat a common noun as a name", () => {
    expect(extractPerson("the class ran long")).toBeNull();
  });
});

describe("classify negation handling", () => {
  it("does not read an absence of music as a volume complaint", () => {
    const top = classify("there was no music during the class", 3);
    const labels = top.map((t) => t.subcategory.toLowerCase());
    expect(labels.some((l) => l.includes("too loud"))).toBe(false);
  });

  it("finds the power outage subcategory for an electricity failure", () => {
    const top = classify("there was no electricity at the studio for an hour", 5);
    expect(top.some((t) => t.subcategory.toLowerCase().includes("power outage"))).toBe(true);
  });
});
