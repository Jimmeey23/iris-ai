import { describe, expect, it } from "vitest";
import {
  issueKnowledgeBlock,
  matchIssuePatterns,
  ownerMatchesHint,
  suggestOwner,
} from "./issue-knowledge";
import { CORPUS } from "./issue-knowledge.generated";

describe("issue pattern memory", () => {
  it("matches an AC/temperature report to the historic temperature family", () => {
    const hits = matchIssuePatterns("the AC has been making the studio super hot all morning, members are sweating");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /temperature/i.test(h.pattern.subcategory))).toBe(true);
  });

  it("matches theft wording to the theft family", () => {
    const hits = matchIssuePatterns("a member's phone went missing from the locker room during the 7pm class");
    expect(hits.some((h) => /theft|missing/i.test(h.pattern.subcategory))).toBe(true);
  });

  it("returns nothing for unrelated text", () => {
    const hits = matchIssuePatterns("quarterly board meeting moved to Thursday");
    // No historic family should confidently claim this.
    expect(hits.every((h) => h.score < 4)).toBe(true);
  });

  it("builds a bounded prompt block that frames history as history", () => {
    const block = issueKnowledgeBlock("AC not cooling in studio 1, hot class", {
      category: "Studio Amenities and Facilities",
      subcategory: "Studio Temperature / AC",
    });
    expect(block).toContain("PATTERN MEMORY");
    expect(block).toContain(String(CORPUS.total));
    expect(block.length).toBeLessThan(2600);
    expect(block.toLowerCase()).toContain("not instructions");
  });
});

describe("ownership priors", () => {
  it("suggests a historic owner for a known family", () => {
    expect(suggestOwner("Studio Amenities and Facilities", "Studio Temperature / AC")).toBeTruthy();
  });

  it("suggests nothing for an unknown category", () => {
    expect(suggestOwner("Nonexistent Category", "Nonexistent Sub")).toBeUndefined();
  });

  it("matches staff names against historic owner hints", () => {
    expect(ownerMatchesHint("Shipra Bhika", "Shipra Bhika (Bandra Studio)")).toBe(true);
    expect(ownerMatchesHint("Jimmeey Gondaa", "Jimmeey")).toBe(true);
    expect(ownerMatchesHint("Reyna Jagtiani", "Shipra Bhika")).toBe(false);
  });
});
