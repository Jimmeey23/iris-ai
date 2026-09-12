import { beforeEach, expect, it, vi } from "vitest";
import { applyOptionAnswer, runAgentTurn } from "./agent-session";
import { runAgent, type AgentTurn } from "./agent";
import { emptyState, markSlotSource } from "./chat-engine";
import { questionBudget } from "./guardrails";
import { momenceAvailable, runTools } from "./agent-tools";
import type { ChatMessage } from "./types";

vi.mock("./agent", async (original) => ({ ...await original<typeof import("./agent")>(), runAgent: vi.fn() }));
vi.mock("./recurrence", () => ({ findRelatedTickets: vi.fn(async () => []) }));
vi.mock("./memory", () => ({ findContextFacts: vi.fn(async () => []) }));
vi.mock("./agent-tools", () => ({ momenceAvailable: vi.fn(async () => false), runTools: vi.fn(async () => []) }));
vi.mock("./guardrails", async (original) => ({
  ...await original<typeof import("./guardrails")>(), questionBudget: vi.fn(async () => 6),
}));

const studios = [
  { id: 1, name: "Kwality House, Kemps Corner", code: "KC", city: "Mumbai", isHq: false },
  { id: 2, name: "Supreme HQ, Bandra", code: "BAN", city: "Mumbai", isHq: false },
];
const ctx = { studios, reporter: { name: "Jimmeey", role: "Operations" } };
function state() {
  const s = emptyState();
  s.data = { rawText: "A member reported an outage. The cooler was provided.", studioName: "Kemps Corner", studioId: 1,
    impact: "many", resolvedNow: true, actionTaken: "Provided a cooler", occurredAt: "Yesterday", frequency: "First time" };
  return s;
}
function model(patch: Partial<AgentTurn> = {}) {
  const turn: AgentTurn = {
    reportEstablished: true, reply: "Got it, Jimmeey.",
    classification: { category: "Repair and Maintenance", subcategory: "Power Outage / Utility Failure", confidence: 0.9, alternates: [] },
    slots: {}, secondaryIssues: [], nextQuestion: null, readyForDraft: true,
    insight: { title: "Power outage disrupted three Kemps Corner classes", summary: "Power was unavailable for an hour and affected three classes.",
      rootCause: "Studio utility power was unavailable.", suggestedAction: "Confirm restoration and inspect the supply.", sentiment: "Negative",
      emotion: "frustrated", urgencyScore: 70, churnRisk: "Medium", effort: "Medium", priority: "High",
      priorityReason: "Multiple classes were affected", tags: ["power-outage"] }, ...patch,
  };
  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn });
}
beforeEach(() => {
  vi.mocked(runAgent).mockReset();
  vi.mocked(questionBudget).mockResolvedValue(6);
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runTools).mockResolvedValue([]);
});

it("shows a complete report without forcing unrelated questions", async () => {
  model();
  const out = await runAgentTurn(state(), [], { text: "That is the full report." }, ctx);
  expect(out.state.step).toBe("review");
  expect(out.state.pendingQuestionId).toBeNull();
});

it("does not add a fixed question to satisfy a configured count", async () => {
  model(); vi.mocked(questionBudget).mockResolvedValue(1);
  const s = state(); s.agentAsked = ["resolvedNow"];
  const out = await runAgentTurn(s, [], { text: "Yes, everything is restored." }, ctx);
  expect(out.state.step).toBe("review");
  expect(out.state.agentAsked).toEqual(["resolvedNow"]);
});

it("rejects a model question whose answer is already captured", async () => {
  model({ readyForDraft: false, insight: undefined, nextQuestion: { id: "actionTaken", ask: "What have you tried?" } });
  const out = await runAgentTurn(state(), [], { text: "The cooler was already provided." }, ctx);
  expect(out.state.data.actionTaken).toBe("Provided a cooler");
  expect(out.state.pendingQuestionId).toBeNull();
  expect(out.state.step).toBe("review");
});

it("binds a plain-text reply to its pending field before model planning", async () => {
  model({ readyForDraft: false, insight: undefined, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" } });
  const s = state(); delete s.data.actionTaken; s.pendingQuestionId = "actionTaken"; s.agentAsked = ["actionTaken"];
  const out = await runAgentTurn(s, [], { text: "We provided a portable cooler." }, ctx);
  expect(out.state.data.actionTaken).toBe("We provided a portable cooler.");
  expect(out.state.data.rawText).toContain("We provided a portable cooler.");
});

it("stores canonical option answers", () => {
  const s = state(); delete s.data.actionTaken;
  applyOptionAnswer("ans:Provided a portable cooler", s, "actionTaken");
  expect(s.data.actionTaken).toBe("Provided a portable cooler");
  expect(s.slotSources?.actionTaken).toBe("user");
});

it("honours a request to stop asking and show the draft", async () => {
  model({ readyForDraft: false, insight: undefined, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" } });
  const out = await runAgentTurn(state(), [], { text: "No more questions, show me the draft." }, ctx);
  expect(out.state.step).toBe("review");
  expect(out.state.pendingQuestionId).toBeNull();
});

it("keeps a skipped resolution unknown", async () => {
  model(); const s = state(); delete s.data.resolvedNow; s.agentAsked = ["studio", "resolvedNow", "impact"];
  const out = await runAgentTurn(s, [], { value: "skip" }, ctx);
  expect(out.state.step).toBe("review");
  expect(out.state.data.resolvedNow).toBeUndefined();
});

it("interprets a correction entered from draft review", async () => {
  model({ corrections: [{ slot: "studio", value: "Bandra", quote: "this was Bandra" }], slots: { studio: { value: "Kemps Corner" } } });
  const s = state(); s.step = "review"; s.data.momenceSessionId = 123;
  const out = await runAgentTurn(s, [], { text: "Correction: this was Bandra, not Kemps Corner." }, ctx);
  expect(out.usedAgent).toBe(true);
  expect(out.state.data.studioName).toContain("Bandra");
  expect(out.state.data.notes).toBeUndefined();
  expect(out.state.data.momenceSessionId).toBeUndefined();
});

it("keeps an explicit trainer correction over a stale slot", async () => {
  model({ corrections: [{ slot: "trainer", value: "KV" }], slots: { trainer: { value: "Old instructor" } },
    readyForDraft: false, insight: undefined, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" } });
  const out = await runAgentTurn(state(), [], { text: "It was KV, not the old instructor." }, ctx);
  expect(out.state.data.trainerName).toBe("KV");
  expect(out.state.slotSources?.trainerName).toBe("user");
});

it("does not restore an old composer studio after correction", async () => {
  model({ readyForDraft: false, insight: undefined, nextQuestion: { id: "witnesses", ask: "Who witnessed it?" } });
  const s = state(); s.data.studioName = "Bandra"; markSlotSource(s, "studio", "user");
  const out = await runAgentTurn(s, [], { text: "Yes.", context: { studioName: "Kemps Corner", studioId: 1 } }, ctx);
  expect(out.state.data.studioName).toBe("Bandra");
});

it("rejects a paraphrased resolution question after resolution is known", async () => {
  model({ readyForDraft: false, insight: undefined, nextQuestion: { id: "custom:current_status", ask: "Is the issue still ongoing?" } });
  const s = state(); s.agentAsked = ["resolvedNow"];
  const out = await runAgentTurn(s, [], { text: "I already said it is fixed." }, ctx);
  expect(out.state.pendingQuestionId).toBeNull();
  expect(out.state.step).toBe("review");
});

it("auto-matches outage context from the first message", async () => {
  model({ readyForDraft: false, insight: undefined, slots: {}, nextQuestion: { id: "resolvedNow", ask: "Was power restored?" } });
  const report = "No electricity at Kemps Corner for an hour. BBB was at 10am, Cycle at 10.30am and FIT at 11am. We moved BBB and provided a portable cooler.";
  const out = await runAgentTurn(emptyState(), [], { text: report }, ctx);
  expect(out.state.data.studioName).toContain("Kemps Corner");
  expect(out.state.data.occurredAt).toBe("Earlier today");
  // Times are normalised: "10 am" and "11. 30am" become real clock times, and
  // a stray "30AM" fragment can no longer reach the ticket.
  expect(out.state.data.classInfo).toContain("10:00 AM");
  // Every listed time must be a whole clock time, never a fragment like "30 AM"
  // left behind when "11. 30am" could not be matched as one token.
  const listedTimes = (out.state.data.classInfo ?? "")
    .split("(")[0]
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  expect(listedTimes).toEqual(["10:00 AM", "10:30 AM", "11:00 AM"]);
  expect(out.state.data.classInfo).toContain("Power Cycle");
  expect(out.state.data.actionTaken).toBe(report);
  expect(out.state.data.rawText).toContain(report);
  expect(out.state.pendingQuestionId).toBe("resolvedNow");
});

it("takes a correction on a ticket that is already raised", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  const raised: ChatMessage = {
    id: "m1", role: "assistant", content: "Done — **TKT-1** is live.", createdAt: new Date().toISOString(),
    kind: "created",
    created: {
      id: 42, ticketNumber: "TKT-1", title: "Mic not working in Studio 2", studioName: "Kwality House, Kemps Corner",
      assigneeName: "Neha", assigneeTeam: "Tech", assigneeEmail: "neha@example.in", assignmentReason: "AV owner",
      slaDueAt: null, priority: "High",
    },
  };
  const s = state();
  s.step = "created";
  s.createdTicketId = 42;
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: {
      reportEstablished: true, postCreated: true,
      reply: "Sorted — Bandra, not Kemps Corner. I've put that on TKT-1.",
      classification: { category: "Tech Issues", subcategory: "Mic Not Working", confidence: 0.9, alternates: [] },
      slots: {}, secondaryIssues: [], nextQuestion: null, readyForDraft: false,
      amendment: { update: "Correction: the studio was Bandra, not Kemps Corner.", kind: "correction" },
    },
  });
  const out = await runAgentTurn(s, [raised], { text: "actually it was Bandra, not Kemps Corner" }, ctx);
  // The old controller answered every message here with "This ticket is already
  // raised. Start a new one below." — a correction had nowhere to go.
  expect(out.usedAgent).toBe(true);
  expect(out.state.step).toBe("created");
  expect(out.messages[0].content).toContain("Bandra");
  expect(out.intent).toMatchObject({ kind: "amend", ticketId: 42 });
  // And the model was told which live ticket the conversation is about.
  expect(vi.mocked(runAgent).mock.calls[0][1].ticket?.ticketNumber).toBe("TKT-1");
});

it("still starts a new ticket from the button on a raised ticket", async () => {
  const s = state();
  s.step = "created";
  s.createdTicketId = 42;
  const out = await runAgentTurn(s, [], { value: "new" }, ctx);
  expect(out.usedAgent).toBe(false);
  expect(out.state.step).toBe("describe");
  expect(vi.mocked(runAgent)).not.toHaveBeenCalled();
});

it("auto-matches a later resolution reply before showing the draft", async () => {
  model(); const s = state(); delete s.data.resolvedNow; s.pendingQuestionId = "resolvedNow"; s.agentAsked = ["resolvedNow"];
  const out = await runAgentTurn(s, [], { text: "Yes, electricity was restored at 11:45 am." }, ctx);
  expect(out.state.data.resolvedNow).toBe(true);
  expect(out.state.data.rawText).toContain("restored at 11:45 am");
  expect(out.state.step).toBe("review");
});

it("gives the model one pass that already carries what was extracted from the message", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(true);
  vi.mocked(runTools).mockResolvedValue([{ tool: "search_member", args: { query: "Asha" }, result: "id=7 Asha Shah" }]);
  const turn: AgentTurn = {
    reportEstablished: true, reply: "I’m checking Asha’s record, Jimmeey.",
    classification: { category: "Member Feedback", subcategory: "General Member Feedback", confidence: 0.8, alternates: [] },
    slots: { momenceMemberId: { value: "7" } },
    secondaryIssues: [], nextQuestion: { id: "custom:request", ask: "What did Asha request?" }, readyForDraft: false,
  };
  vi.mocked(runAgent).mockImplementation(async (_transcript, agentContext) => {
    // The member lookup used to run after the model had already answered and
    // bought a second reasoning pass. It is a pre-fetch now: the single pass
    // sees the facts the message itself yielded, and the model's own question
    // survives to the reporter instead of being replaced by a canned one.
    expect(agentContext.known.member).toBe("Asha");
    expect(agentContext.known.studio).toContain("Kemps Corner");
    return { ok: true, latencyMs: 0, turn };
  });
  const out = await runAgentTurn(emptyState(), [], { text: "A member named Asha raised a concern at Kemps Corner." }, ctx);
  expect(vi.mocked(runAgent)).toHaveBeenCalledTimes(1);
  expect(out.state.data.memberName).toBe("Asha");
  expect(out.state.data.momenceMemberId).toBe(7);
  expect(out.state.pendingQuestionId).toBe("custom:request");
});
