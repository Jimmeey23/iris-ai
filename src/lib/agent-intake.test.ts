import { beforeEach, expect, it, vi } from "vitest";
import { runAgentTurn } from "./agent-session";
import { runAgent, type AgentTurn } from "./agent";
import { emptyState } from "./chat-engine";

vi.mock("./agent", async (original) => ({
  ...await original<typeof import("./agent")>(),
  runAgent: vi.fn(),
}));
vi.mock("./recurrence", () => ({ findRelatedTickets: vi.fn(async () => []) }));
vi.mock("./memory", () => ({ findContextFacts: vi.fn(async () => []) }));
vi.mock("./agent-tools", () => ({ momenceAvailable: vi.fn(async () => false), runTools: vi.fn(async () => []) }));
vi.mock("./guardrails", async (original) => ({
  ...await original<typeof import("./guardrails")>(),
  questionBudget: vi.fn(async () => 5),
}));

const ctx = { studios: [], reporter: { name: "Jimmeey", role: "Operations" } };
const invitation: AgentTurn = {
  reply: "Hey Jimmeey! What did the community member share?",
  reportEstablished: false,
  classification: { category: "Miscellaneous", subcategory: "Internal Operations / Handover", confidence: 0, alternates: [] },
  slots: {}, secondaryIssues: [], nextQuestion: null, readyForDraft: false,
};

beforeEach(() => vi.mocked(runAgent).mockReset());

it("keeps greetings conversational without classification, routing gates or question-budget use", async () => {
  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: invitation, model: "test" });
  const result = await runAgentTurn(emptyState(), [], { text: "hi" }, ctx);
  expect(result.state.step).toBe("describe");
  expect(result.state.data.category).toBeUndefined();
  expect(result.state.agentAsked).toEqual([]);
  expect(result.state.pendingQuestionId).toBeNull();
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].content).toBe(invitation.reply);
  expect(result.messages[0].analysis).toBeUndefined();
});

it("starts routing when a real report follows a greeting", async () => {
  vi.mocked(runAgent).mockResolvedValueOnce({ ok: true, latencyMs: 0, turn: invitation });
  const opening = await runAgentTurn(emptyState(), [], { text: "hi" }, ctx);
  vi.mocked(runAgent).mockResolvedValueOnce({ ok: true, latencyMs: 0, turn: {
    ...invitation, reportEstablished: true,
    reply: "The member reported a cold practice space.",
    classification: { ...invitation.classification, confidence: 0.8 },
    nextQuestion: { id: "studio", ask: "Which studio does this relate to?" },
  } });
  const result = await runAgentTurn(opening.state, [
    { id: "u1", role: "user", content: "hi", createdAt: new Date().toISOString() },
    ...opening.messages,
  ], { text: "A member said the practice space was too cold." }, ctx);
  expect(result.state.step).toBe("agent_q");
  expect(result.state.pendingQuestionId).toBe("studio");
  expect(result.state.agentAsked).toEqual(["studio"]);
});
