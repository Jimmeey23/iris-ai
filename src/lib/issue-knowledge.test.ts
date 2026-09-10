import { describe, expect, it } from "vitest";
import {
  issueKnowledgeBlock,
  matchIssuePatterns,
  ownerMatchesHint,
  suggestOwner,
} from "./issue-knowledge";
import { CORPUS } from "./issue-knowledge.generated";
import { MIN_AGENT_QUESTIONS, followUpQuestion } from "./agent-session";
import type { IntakeState } from "./chat-engine";
import type { EngineContext } from "./chat-engine";

function state(patch: Partial<IntakeState> = {}): IntakeState {
  return {
    step: "agent_q",
    data: {},
    suggestions: [],
    showAllSubs: false,
    editingField: null,
    createdTicketId: null,
    ...patch,
  } as unknown as IntakeState;
}

const ctx = {
  reporter: { name: "Dev User", role: "Studio Manager" },
  studios: [],
} as unknown as EngineContext;

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

describe("coverage floor", () => {
  it("requires at least four questions before drafting", () => {
    expect(MIN_AGENT_QUESTIONS).toBeGreaterThanOrEqual(4);
  });

  it("walks a high-value ladder when the model runs out early", () => {
    const s = state({ agentAsked: ["problem_detail"] });
    const q1 = followUpQuestion(s, ctx);
    expect(q1?.id).toBe("actionTaken");
    expect(q1?.ask).toContain("Dev"); // personalised with the first name

    const s2 = state({ agentAsked: ["problem_detail", "actionTaken", "occurredAt", "frequency"] });
    const q2 = followUpQuestion(s2, ctx);
    expect(["membershipRef", "witnesses", "custom:owner_update"]).toContain(q2?.id);
  });

  it("never repeats a ladder question and stops at the cap", () => {
    let s = state({ agentAsked: [] });
    const seen: string[] = [];
    for (let i = 0; i < 8 && s; i++) {
      const q = followUpQuestion(s, ctx);
      if (!q) break;
      expect(seen).not.toContain(q.id);
      seen.push(q.id);
      s = state({ agentAsked: [...(s.agentAsked ?? []), q.id], data: s.data });
    }
    expect(seen.length).toBeLessThanOrEqual(5);
    expect(seen.length).toBeGreaterThanOrEqual(4);
  });

  it("skips member-specific questions when no member is involved", () => {
    const s = state({
      agentAsked: ["actionTaken", "occurredAt", "frequency"],
      data: { raisedFor: "Noticed by staff" },
    } as Partial<IntakeState>);
    const q = followUpQuestion(s, ctx);
    expect(q?.id).not.toBe("membershipRef");
  });
});
