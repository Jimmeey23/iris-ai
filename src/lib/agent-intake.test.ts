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

it.each(["describe", "agent_q"] as const)("renders the power-outage question once in %s", async (step) => {
  const state = emptyState();
  state.step = step;
  state.data.studioId = null;
  state.data.studioName = "Kemps Corner";
  if (step === "agent_q") state.agentAsked = ["occurredAt"];
  const ask = "Was the power issue resolved by 11:30 am?";
  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: {
    ...invitation, reportEstablished: true,
    reply: `Got it, Jimmeey. Sounds like a rough morning at Kemps Corner. ${ask}`,
    classification: { ...invitation.classification, confidence: 0.9 },
    nextQuestion: {
      id: "resolvedNow", ask,
      why: "To determine if the issue is ongoing or resolved.",
      options: [{ label: "Resolved", value: "yes" }, { label: "Still happening", value: "no" }],
    },
  } });
  const result = await runAgentTurn(state, [], { text: "There was no electricity for an hour at Kemps Corner." }, ctx);
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].content.split(ask)).toHaveLength(2);
  // The card is the question and its answers only: the model's acknowledgement,
  // the why-line, the detected chips and the analysis grid all used to sit
  // around the question and buried it. Detected facts live in the capture panel.
  expect(result.messages[0].content).toBe(ask);
  expect(result.messages[0].content).not.toContain("Got it, Jimmeey.");
  expect(result.messages[0].options).toHaveLength(2);
  expect(result.state.pendingQuestionId).toBe("resolvedNow");
  expect(result.messages[0].analysis).toBeUndefined();
  expect(result.messages[0].inferred).toBeUndefined();
});

it("removes the model's original ask when a routing gate replaces it", async () => {
  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: {
    ...invitation, reportEstablished: true,
    reply: "Got it, Jimmeey. Has the electricity returned?",
    nextQuestion: { id: "resolvedNow", ask: "Is the power back?" },
  } });
  const result = await runAgentTurn(emptyState(), [], { text: "The electricity went out." }, ctx);
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0].content).toContain("Which studio does this relate to?");
  expect(result.messages[0].content).not.toContain("Has the electricity returned?");
  expect(result.messages[0].content).not.toContain("Is the power back?");
});
