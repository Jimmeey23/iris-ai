import { beforeEach, expect, it, vi } from "vitest";
import { timeGreeting, istHour } from "./conversation";
import { localEnrich } from "./enrich";
import { computeSla } from "./sla";
import { isGreetingOnly, runAgentTurn } from "./agent-session";
import { runAgent, type AgentTurn } from "./agent";
import { emptyState } from "./chat-engine";
import { questionBudget } from "./guardrails";
import { momenceAvailable, runTools } from "./agent-tools";

/* ------------------------------------------------------------------ */
/* Greeting is time-appropriate                                        */
/* ------------------------------------------------------------------ */

// 1:11 am IST. The old check was `h < 12 → "Morning"`, which greeted a manager
// messaging in the small hours with "Morning".
const oneAmIst = new Date("2026-09-10T19:41:00Z");

it("does not call 1am 'morning'", () => {
  expect(istHour(oneAmIst)).toBe(1);
  expect(timeGreeting(oneAmIst)).not.toMatch(/morning/i);
});

it.each([
  ["2026-09-10T19:41:00Z", 1, "You're up late"],
  ["2026-09-11T03:30:00Z", 9, "Morning"],
  ["2026-09-11T08:30:00Z", 14, "Afternoon"],
  ["2026-09-11T15:30:00Z", 21, "Evening"],
])("greets %s (IST hour %i) with %s", (iso, hour, expected) => {
  expect(istHour(new Date(iso))).toBe(hour);
  expect(timeGreeting(new Date(iso))).toBe(expected);
});

it("never reads midnight as hour 24", () => {
  expect(istHour(new Date("2026-09-10T18:31:00Z"))).toBe(0);
  expect(timeGreeting(new Date("2026-09-10T18:31:00Z"))).toBe("You're up late");
});

/* ------------------------------------------------------------------ */
/* Titles are labels, not transcript slices                            */
/* ------------------------------------------------------------------ */

const outage =
  "HI, there was no electricity at the Studio for an hour at kemps Corner - we had BBB scheduled at 10 am, cycle at 10.30am and FIT at 11 am. Strength lab had electricity so we moved the BBB to that room.";

it("never lets a greeting reach the ticket title", () => {
  const ai = localEnrich({
    text: `hi ${outage}`,
    category: "Repair and Maintenance",
    subcategory: "Power Outage / Utility Failure",
    studioName: "Kwality House, Kemps Corner",
    resolvedNow: false,
  });
  expect(ai.title).not.toMatch(/^h(i|ey|ello)/i);
  expect(ai.title).not.toMatch(/hi hi/i);
});

it("builds a scannable title for a long report instead of truncating it", () => {
  const ai = localEnrich({
    text: outage,
    category: "Repair and Maintenance",
    subcategory: "Power Outage / Utility Failure",
    studioName: "Kwality House, Kemps Corner",
    classInfo: "10:00 am BBB, 10:30 am Power Cycle, 11:00 am Studio FIT",
    resolvedNow: false,
  });
  expect(ai.title).toBe(
    "Power Outage / Utility Failure — Kwality House (3 classes affected, still unresolved)",
  );
  expect(ai.title).not.toMatch(/…$/);
});

it("keeps the reporter's own words when they already read as a headline", () => {
  const ai = localEnrich({
    text: "The mic in Studio 2 has stopped working",
    category: "Tech Issues",
    subcategory: "Mic Not Working",
    studioName: "Kwality House, Kemps Corner",
  });
  expect(ai.title).toBe("The mic in Studio 2 has stopped working");
});

/* ------------------------------------------------------------------ */
/* Root cause reads the narrative                                      */
/* ------------------------------------------------------------------ */

it("describes the narrated fault rather than a generic category cause", () => {
  const ai = localEnrich({
    text: outage,
    category: "Repair and Maintenance",
    subcategory: "Power Outage / Utility Failure",
  });
  expect(ai.rootCause).not.toMatch(/deferred preventive maintenance/i);
  expect(ai.rootCause).toMatch(/electrical supply/i);
  // The partial-outage clue is the whole point — one room kept power.
  expect(ai.rootCause).toMatch(/circuit|phase|distribution/i);
});

it("still falls back to the category cause when no signal matches", () => {
  const ai = localEnrich({
    text: "The changing room bench is wobbly",
    category: "Repair and Maintenance",
    subcategory: "Broken Equipment Not Repaired",
  });
  expect(ai.rootCause).toMatch(/deferred preventive maintenance/i);
});

/* ------------------------------------------------------------------ */
/* Effort scores the fix, not the workaround                            */
/* ------------------------------------------------------------------ */

it("does not score a live utility fault as low effort because a cooler was moved", () => {
  const ai = localEnrich({
    text: `${outage} A portable cooler was provided and later moved to the FIT room.`,
    category: "Repair and Maintenance",
    subcategory: "Power Outage / Utility Failure",
    resolvedNow: false,
  });
  expect(ai.effort).not.toBe("Low");
});

it("raises urgency when a fault is confirmed still happening", () => {
  const common = {
    text: outage,
    category: "Repair and Maintenance",
    subcategory: "Power Outage / Utility Failure",
  } as const;
  const live = localEnrich({ ...common, resolvedNow: false });
  const fixed = localEnrich({ ...common, resolvedNow: true });
  expect(live.urgencyScore).toBeGreaterThan(fixed.urgencyScore);
});

/* ------------------------------------------------------------------ */
/* SLA targets are commitments people can work to                       */
/* ------------------------------------------------------------------ */

const slaInput = {
  category: "Repair and Maintenance",
  subcategory: "Power Outage / Utility Failure",
  urgencyScore: 81,
  churnRisk: "Low",
  sentiment: "Neutral",
  impact: "many",
};

it("snaps SLA targets to real tiers instead of emitting 7.25h / 14.5h", () => {
  const sla = computeSla(slaInput);
  expect(sla.respondHours).toBe(1);
  expect(sla.resolveHours).toBe(12);
  for (const h of [sla.respondHours, sla.resolveHours]) {
    expect(Number.isInteger(h) || [0.25, 0.5].includes(h)).toBe(true);
  }
});

it("tightens the response target when the fault is still happening", () => {
  const live = computeSla({ ...slaInput, resolvedNow: false });
  const fixed = computeSla({ ...slaInput, resolvedNow: true });
  expect(live.respondHours).toBeLessThanOrEqual(1);
  expect(live.respondHours).toBeLessThanOrEqual(fixed.respondHours);
  expect(live.reason).toMatch(/still unresolved/i);
});

it("never promises to resolve sooner than it promises to respond", () => {
  const sla = computeSla({
    category: "Safety and Security",
    subcategory: "Handling of Medical Emergencies",
    urgencyScore: 99,
    churnRisk: "High",
    sentiment: "Escalated",
    impact: "safety",
    atRisk: true,
  });
  expect(sla.resolveHours).toBeGreaterThanOrEqual(sla.respondHours);
});

/* ------------------------------------------------------------------ */
/* Greeting detection                                                   */
/* ------------------------------------------------------------------ */

it.each(["hi", "HI", "hii", "hey", "hello!", "hey Iris", "good morning", "you there?"])(
  "treats %s as a greeting",
  (text) => expect(isGreetingOnly(text)).toBe(true),
);

it.each([
  "hi, there was no electricity at the studio",
  "hello — the mic is dead in Studio 2",
  "morning class had no AC",
])("treats %s as a real report", (text) => expect(isGreetingOnly(text)).toBe(false));

/* ------------------------------------------------------------------ */
/* Conversation controller                                              */
/* ------------------------------------------------------------------ */

vi.mock("./agent", async (original) => ({
  ...(await original<typeof import("./agent")>()),
  runAgent: vi.fn(),
}));
vi.mock("./recurrence", () => ({ findRelatedTickets: vi.fn(async () => []) }));
vi.mock("./memory", () => ({ findContextFacts: vi.fn(async () => []) }));
vi.mock("./agent-tools", () => ({
  momenceAvailable: vi.fn(async () => false),
  runTools: vi.fn(async () => []),
}));
vi.mock("./guardrails", async (original) => ({
  ...(await original<typeof import("./guardrails")>()),
  questionBudget: vi.fn(async () => 6),
}));

const studios = [
  { id: 1, name: "Kwality House, Kemps Corner", code: "KC", city: "Mumbai", isHq: false },
];
const ctx = { studios, reporter: { name: "Jimmeey", role: "Head of Sales" } };

function turn(patch: Partial<AgentTurn> = {}): AgentTurn {
  return {
    reportEstablished: true,
    reply: "Got it, Jimmeey.",
    classification: {
      category: "Repair and Maintenance",
      subcategory: "Power Outage / Utility Failure",
      confidence: 0.9,
      alternates: [],
    },
    slots: {},
    secondaryIssues: [],
    nextQuestion: null,
    readyForDraft: true,
    ...patch,
  };
}

beforeEach(() => {
  vi.mocked(runAgent).mockReset();
  vi.mocked(questionBudget).mockResolvedValue(6);
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runTools).mockResolvedValue([]);
});

it("keeps a bare greeting out of the durable narrative even when the model misflags it", async () => {
  // The model wrongly reports this greeting as an established report.
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({ reportEstablished: true, readyForDraft: false, reply: "Hey Jimmeey!" }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: "hi" }, ctx);
  expect(out.state.data.rawText).toBeUndefined();
  expect(out.state.step).toBe("describe");
  expect(out.state.data.category).toBeUndefined();
});

it("still records a report that merely opens with a greeting", async () => {
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({ readyForDraft: false, nextQuestion: { id: "studio", ask: "Which studio?" } }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: `hi ${outage}` }, ctx);
  expect(out.state.data.rawText).toContain("no electricity");
});

it("confirms an inferred blast radius before it sets the SLA clock", async () => {
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      slots: {
        studio: { value: "Kemps Corner" },
        impact: { value: "many" },
        raisedFor: { value: "Noticed by staff" },
        resolvedNow: { value: false },
        occurredAt: { value: "Earlier today" },
        frequency: { value: "First time" },
      },
    }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: outage }, ctx);
  expect(out.state.pendingQuestionId).toBe("impact");
  expect(out.state.agentAsked).toContain("impact");
  expect(out.messages[0].content).toMatch(/how many members/i);
});

it("does not re-confirm a blast radius the reporter set themselves", async () => {
  const state = emptyState();
  state.data = { impact: "many" };
  state.slotSources = { impact: "user" };
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      slots: {
        studio: { value: "Kemps Corner" },
        raisedFor: { value: "Noticed by staff" },
        resolvedNow: { value: true },
        occurredAt: { value: "Earlier today" },
        frequency: { value: "First time" },
      },
    }),
  });
  const out = await runAgentTurn(state, [], { text: outage }, ctx);
  expect(out.state.agentAsked ?? []).not.toContain("impact");
});

it("carries a question it asked but never got an answer to onto the ticket", async () => {
  const state = emptyState();
  state.step = "agent_q";
  state.data = {
    rawText: outage,
    studioName: "Kwality House, Kemps Corner",
    studioId: 1,
    impact: "single",
    resolvedNow: false,
    occurredAt: "Earlier today",
    frequency: "First time",
    raisedFor: "Noticed by staff",
  };
  state.slotSources = { impact: "user" };
  state.agentAsked = ["custom:fit_trainer"];
  state.agentAskLog = [{ id: "custom:fit_trainer", ask: "Who was teaching the 11 am FIT class?" }];
  state.pendingQuestionId = "custom:fit_trainer";

  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(state, [], { text: "just raise the ticket" }, ctx);
  expect(out.state.step).toBe("review");
  expect(out.state.data.extraDetails?.["Still to confirm"]).toContain("11 am FIT");
});

/* ------------------------------------------------------------------ */
/* A model turn that says two things at once is not a failure           */
/* ------------------------------------------------------------------ */

it("treats readyForDraft alongside a question as a question turn, not an error", async () => {
  // The model does not want to drop the question it just asked, so it returns
  // both. Rejecting that dead-ended the whole conversation.
  const { isCoherentAgentTurn } = await import("./agent");
  const both = turn({
    readyForDraft: true,
    nextQuestion: { id: "custom:cause", ask: "Who's looking at the supply?" },
  });
  // Raw payloads like this are exactly what the old pre-normalisation check
  // rejected outright.
  expect(isCoherentAgentTurn(both)).toBe(false);

  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: both });
  const out = await runAgentTurn(emptyState(), [], { text: outage }, ctx);
  expect(out.degraded).toBeUndefined();
});

/* ------------------------------------------------------------------ */
/* A failing reasoning pass must not trap the report                    */
/* ------------------------------------------------------------------ */

function reportState() {
  const s = emptyState();
  s.data = {
    rawText: outage,
    studioName: "Kwality House, Kemps Corner",
    studioId: 1,
    category: "Repair and Maintenance",
    subcategory: "Power Outage / Utility Failure",
    resolvedNow: false,
    occurredAt: "Earlier today",
    frequency: "First time",
    raisedFor: "Noticed by staff",
  };
  return s;
}

it("offers a retry on the first reasoning failure", async () => {
  vi.mocked(runAgent).mockResolvedValue({ ok: false, latencyMs: 0, error: "incoherent-agent-turn" });
  const out = await runAgentTurn(reportState(), [], { text: "Not sure" }, ctx);
  expect(out.state.step).toBe("agent_unavailable");
  expect(out.state.agentFailures).toBe(1);
});

it("stops looping and drafts from what it has when the retry fails too", async () => {
  vi.mocked(runAgent).mockResolvedValue({ ok: false, latencyMs: 0, error: "incoherent-agent-turn" });
  const history = [
    { id: "u1", role: "user" as const, content: outage, createdAt: new Date().toISOString() },
  ];
  const first = await runAgentTurn(reportState(), history, { text: "Not sure" }, ctx);
  const second = await runAgentTurn(first.state, history, { value: "retry" }, ctx);
  expect(second.state.step).toBe("review");
  expect(second.state.insight?.title).toBeTruthy();
  expect(second.messages.some((m) => m.kind === "draft")).toBe(true);
  expect(second.messages[0].content).toMatch(/didn't complete/i);
});

it("clears the failure streak once a pass completes", async () => {
  vi.mocked(runAgent).mockResolvedValueOnce({ ok: false, latencyMs: 0, error: "boom" });
  const failed = await runAgentTurn(reportState(), [], { text: "Not sure" }, ctx);
  expect(failed.state.agentFailures).toBe(1);
  vi.mocked(runAgent).mockResolvedValueOnce({ ok: true, latencyMs: 0, turn: turn() });
  const ok = await runAgentTurn(failed.state, [], { text: "power is back" }, ctx);
  expect(ok.state.agentFailures).toBe(0);
});

/* ------------------------------------------------------------------ */
/* "Not sure" is an answer, not agreement                               */
/* ------------------------------------------------------------------ */

it("drops an inferred blast radius the reporter could not confirm", async () => {
  const s = reportState();
  s.step = "agent_q";
  s.data.impact = "many";
  s.slotSources = { impact: "agent" };
  s.agentAsked = ["impact"];
  s.agentAskLog = [{ id: "impact", ask: "How many members were actually affected?" }];
  s.pendingQuestionId = "impact";

  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(s, [], { text: "Not sure" }, ctx);
  // The guess must not go on driving severity once it was explicitly unconfirmed.
  expect(out.state.data.impact).toBeUndefined();
  expect(out.state.data.extraDetails?.["Members affected"]).toMatch(/could not confirm/i);
  expect(out.state.data.extraDetails?.["Still to confirm"]).toMatch(/how many members/i);
});

it("keeps a blast radius the reporter confirmed themselves", async () => {
  const s = reportState();
  s.step = "agent_q";
  s.data.impact = "many";
  s.slotSources = { impact: "user" };
  s.agentAsked = ["impact"];
  s.pendingQuestionId = "impact";

  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(s, [], { text: "Not sure" }, ctx);
  expect(out.state.data.impact).toBe("many");
});

it("does not flag a question the reporter actually answered", async () => {
  const state = emptyState();
  state.step = "agent_q";
  state.data = {
    rawText: outage,
    studioName: "Kwality House, Kemps Corner",
    studioId: 1,
    impact: "single",
    resolvedNow: false,
    occurredAt: "Earlier today",
    frequency: "First time",
    raisedFor: "Noticed by staff",
  };
  state.slotSources = { impact: "user" };
  state.agentAsked = ["custom:fit_trainer"];
  state.agentAskLog = [{ id: "custom:fit_trainer", ask: "Who was teaching the 11 am FIT class?" }];
  state.pendingQuestionId = "custom:fit_trainer";

  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(state, [], { text: "Anisha taught the FIT class" }, ctx);
  expect(out.state.data.extraDetails?.["Still to confirm"]).toBeUndefined();
});
