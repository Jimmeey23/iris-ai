import { describe, expect, it } from "vitest";
import { isCoherentAgentTurn, type AgentTurn } from "./agent";

function turn(patch: Partial<AgentTurn>): AgentTurn {
  return {
    reply: "I understand the issue.",
    classification: { category: "Miscellaneous", subcategory: "General", confidence: 0.8, alternates: [] },
    slots: {},
    secondaryIssues: [],
    nextQuestion: null,
    readyForDraft: false,
    ...patch,
  };
}

describe("agent turn contract", () => {
  it("accepts a conversational invitation before a report exists", () => {
    expect(isCoherentAgentTurn(turn({ reportEstablished: false, reply: "What happened?" }))).toBe(true);
    expect(isCoherentAgentTurn(turn({ reportEstablished: false, readyForDraft: true }))).toBe(false);
    expect(isCoherentAgentTurn(turn({ reportEstablished: false, toolCalls: [{ tool: "search_member", args: { query: "hi" } }] }))).toBe(false);
  });

  it("accepts a contextual follow-up question", () => {
    expect(isCoherentAgentTurn(turn({ nextQuestion: { id: "custom:current_state", ask: "Is the AC still down?" } }))).toBe(true);
  });

  it("accepts a tool lookup pause", () => {
    expect(isCoherentAgentTurn(turn({ toolCalls: [{ tool: "find_sessions", args: { date: "2026-09-04" } }] }))).toBe(true);
  });

  it("accepts only an explicit, question-free draft decision", () => {
    expect(isCoherentAgentTurn(turn({ readyForDraft: true }))).toBe(true);
  });

  it("rejects an implicit draft caused by missing output", () => {
    expect(isCoherentAgentTurn(turn({}))).toBe(false);
  });

  it("rejects contradictory draft and question output", () => {
    expect(isCoherentAgentTurn(turn({ readyForDraft: true, nextQuestion: { id: "studio", ask: "Which studio?" } }))).toBe(false);
  });
});
