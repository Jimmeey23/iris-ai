import { beforeEach, expect, it, vi } from "vitest";
import { runAgentTurn } from "./agent-session";
import { runAgent, type AgentTurn } from "./agent";
import { emptyState, markSlotSource } from "./chat-engine";

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

import { questionBudget } from "./guardrails";
import { applyOptionAnswer } from "./agent-session";

// Characterization tests: these PASS when the audited defects are present.
// Replace with desired-behavior assertions as each finding is remediated.
const ctx = { studios: [], reporter: { name: "Jimmeey", role: "Operations" } };
function state() {
  const s = emptyState();
  s.data = {
    rawText: "A member reported an outage. The cooler was provided.",
    studioName: "Kemps Corner", studioId: null,
    impact: "many", resolvedNow: true,
    actionTaken: "Provided a cooler", occurredAt: "Yesterday", frequency: "First time",
  };
  return s;
}
function model(patch: Partial<AgentTurn> = {}) {
  const turn: AgentTurn = {
    reportEstablished: true, reply: "Got it, Jimmeey.",
    classification: { category: "Repair and Maintenance", subcategory: "Power Outage / Utility Failure", confidence: 0.9, alternates: [] },
    slots: {}, secondaryIssues: [], nextQuestion: null, readyForDraft: true, ...patch,
  };
  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn });
}
beforeEach(() => {
  vi.mocked(runAgent).mockReset();
  vi.mocked(questionBudget).mockResolvedValue(6);
});

it("AUDIT: ready-to-draft report is forced into an unrelated witness question", async () => {
  model();
  const out = await runAgentTurn(state(), [], { text: "That is the full report." }, ctx);
  expect(out.state.step).toBe("agent_q");
  expect(out.state.pendingQuestionId).toBe("witnesses");
});

it("AUDIT: the ladder exceeds an exhausted configured question budget", async () => {
  model();
  vi.mocked(questionBudget).mockResolvedValue(1);
  const s = state();
  s.agentAsked = ["resolvedNow"];
  const out = await runAgentTurn(s, [], { text: "Yes, everything is restored." }, ctx);
  expect(out.state.agentAsked).toHaveLength(2);
  expect(out.state.pendingQuestionId).toBe("witnesses");
});

it("AUDIT: known answered slots are not filtered from a new model question", async () => {
  model({ readyForDraft: false, nextQuestion: { id: "actionTaken", ask: "What have you tried?" } });
  const out = await runAgentTurn(state(), [], { text: "The cooler was already provided." }, ctx);
  expect(out.state.data.actionTaken).toBe("Provided a cooler");
  expect(out.state.pendingQuestionId).toBe("actionTaken");
});

it("AUDIT: plain-text answer is not bound to pending actionTaken if the model omits the slot", async () => {
  model({ readyForDraft: false, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" } });
  const s = state();
  delete s.data.actionTaken;
  s.pendingQuestionId = "actionTaken";
  s.agentAsked = ["actionTaken"];
  const out = await runAgentTurn(s, [], { text: "We provided a portable cooler." }, ctx);
  expect(out.state.data.actionTaken).toBeUndefined();
  expect(out.state.data.rawText).not.toContain("We provided a portable cooler.");
});

it("AUDIT: canonical actionTaken button silently fails to store its answer", () => {
  const s = state();
  delete s.data.actionTaken;
  applyOptionAnswer("ans:Provided a portable cooler", s, "actionTaken");
  expect(s.data.actionTaken).toBeUndefined();
  expect(s.slotSources?.actionTaken).toBe("user");
});

it("AUDIT: no-more-questions request does not suppress the model's optional question", async () => {
  model({ readyForDraft: false, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" } });
  const out = await runAgentTurn(state(), [], { text: "No more questions, draft it now." }, ctx);
  expect(out.state.pendingQuestionId).toBe("witnesses");
});

it("AUDIT: skipped unknown resolution becomes a factual false value in a draft", async () => {
  model();
  const s = state();
  delete s.data.resolvedNow;
  s.agentAsked = ["studio", "resolvedNow", "impact", "witnesses"];
  const out = await runAgentTurn(s, [], { value: "skip" }, ctx);
  expect(out.state.step).toBe("review");
  expect(out.state.data.resolvedNow).toBe(false);
});

it("AUDIT: correction in review is appended to notes without updating the studio", async () => {
  const s = state();
  s.step = "review";
  const out = await runAgentTurn(s, [], { text: "Correction: this was Bandra, not Kemps Corner." }, ctx);
  expect(out.usedAgent).toBe(false);
  expect(out.state.data.studioName).toBe("Kemps Corner");
  expect(out.state.data.notes).toContain("Bandra");
  expect(runAgent).not.toHaveBeenCalled();
});

it("AUDIT: trainer correction is overwritten by a stale slot in the same response", async () => {
  model({
    corrections: [{ slot: "trainer", value: "KV" }],
    slots: { trainer: { value: "Old instructor" } },
    readyForDraft: false, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" },
  });
  const out = await runAgentTurn(state(), [], { text: "It was KV, not the old instructor." }, ctx);
  expect(out.state.data.trainerName).toBe("Old instructor");
  expect(out.state.slotSources?.trainer).toBe("user");
});

it("AUDIT: persistent composer context restores an old studio after a correction", async () => {
  model({ readyForDraft: false, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" } });
  const s = state();
  s.data.studioName = "Bandra";
  markSlotSource(s, "studio", "user");
  const out = await runAgentTurn(s, [], { text: "Yes.", context: { studioName: "Kemps Corner", studioId: 1 } }, ctx);
  expect(out.state.data.studioName).toBe("Kemps Corner");
});

it("AUDIT: a paraphrased duplicate gets through when it uses a different question ID", async () => {
  model({ readyForDraft: false, nextQuestion: { id: "custom:current_status", ask: "Is the issue still ongoing?" } });
  const s = state();
  s.agentAsked = ["resolvedNow"];
  const out = await runAgentTurn(s, [], { text: "I already said it is fixed." }, ctx);
  expect(out.state.pendingQuestionId).toBe("custom:current_status");
});

it("AUDIT: nulling a repeated question drafts even when the model says not ready", async () => {
  model({ readyForDraft: false, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" } });
  const s = state();
  s.agentAsked = ["studio", "resolvedNow", "impact", "witnesses"];
  const out = await runAgentTurn(s, [], { text: "I do not know." }, ctx);
  expect(out.state.step).toBe("review");
});
