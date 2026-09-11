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
/* Time parsing and rooms vs classes                                    */
/* ------------------------------------------------------------------ */

it("reads a time split by punctuation instead of emitting a fragment", async () => {
  const { extractTimes } = await import("./chat-inference");
  // "11. 30am" is the shape that produced a bare "30AM" on the ticket.
  expect(extractTimes("at 11. 30am the cooler was moved")).toEqual(["11:30 AM"]);
  expect(extractTimes("BBB at 10 am, cycle at 10.30am and FIT at 11 am")).toEqual([
    "10:00 AM",
    "10:30 AM",
    "11:00 AM",
  ]);
});

it("discards impossible clock values rather than passing them through", async () => {
  const { extractTimes } = await import("./chat-inference");
  expect(extractTimes("call 98765 43210 am")).toEqual([]);
  expect(extractTimes("at 25 am")).toEqual([]);
  expect(extractTimes("at 10:75 am")).toEqual([]);
});

it("treats a room as a location, never as a class", async () => {
  const { inferFromText } = await import("./chat-inference");
  const s = emptyState();
  inferFromText(outage, s, ctx);
  expect(s.data.location).toBe("Strength Lab");
  expect(s.data.classInfo ?? "").not.toMatch(/strength lab/i);
});

it("marks regex-extracted facts as the machine's reading, not the reporter's word", async () => {
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({ readyForDraft: false, nextQuestion: { id: "studio", ask: "Which studio?" } }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: outage }, ctx);
  // Labelling these "user" human-locked them: the model could not correct the
  // class list and the controller suppressed every question about it.
  expect(out.state.slotSources?.classInfo).toBe("agent");
  expect(out.state.slotSources?.classInfo).not.toBe("user");
});

/* ------------------------------------------------------------------ */
/* Scheduled work is not an incident                                    */
/* ------------------------------------------------------------------ */

const renovation =
  "Studio 1 at Bandra will be closed for renovations to the Strength Lab from the 14th for 10 days.";

it("recognises announced work as planned, with its window", async () => {
  const { detectPlannedWork } = await import("./chat-inference");
  const got = detectPlannedWork(renovation);
  expect(got.planned).toBe(true);
  expect(got.window).toBe("From 14th for 10 days");
});

it("does not mistake a timetable mention for planned work", async () => {
  const { detectPlannedWork } = await import("./chat-inference");
  // "BBB scheduled at 10 am" is a class, not a renovation notice.
  expect(detectPlannedWork(outage).planned).toBe(false);
  expect(detectPlannedWork("the 6pm class is scheduled as usual").planned).toBe(false);
});

it("treats a live fault as a fault even when it mentions upcoming work", async () => {
  const { detectPlannedWork } = await import("./chat-inference");
  expect(
    detectPlannedWork("the AC is not working and a replacement is scheduled for the 20th").planned,
  ).toBe(false);
});

it("does not let scheduled work become a Critical, minutes-to-respond ticket", () => {
  const ai = localEnrich({
    text: renovation,
    category: "Repair and Maintenance",
    subcategory: "Planned Closure / Renovation",
    studioName: "Supreme HQ, Bandra",
    impact: "many",
    plannedWork: true,
  });
  expect(ai.priority).not.toBe("Critical");
  expect(ai.urgencyScore).toBeLessThan(70);
  expect(ai.severity).not.toBe("Severe");
  expect(ai.slaRespondHours).toBeGreaterThanOrEqual(1);
});

it("does not describe planned work as a fault or as unresolved", () => {
  const ai = localEnrich({
    text: renovation,
    category: "Repair and Maintenance",
    subcategory: "Planned Closure / Renovation",
    studioName: "Supreme HQ, Bandra",
    plannedWork: true,
  });
  expect(ai.rootCause).not.toMatch(/deferred preventive maintenance/i);
  expect(ai.rootCause).toMatch(/no fault to diagnose/i);
  expect(ai.title).not.toMatch(/unresolved/i);
});

it("still escalates planned work when a real hazard is described", () => {
  const ai = localEnrich({
    text: "Renovation starts on the 14th and there is an exposed live wire on the floor right now",
    category: "Repair and Maintenance",
    subcategory: "Planned Closure / Renovation",
    plannedWork: true,
    atRisk: true,
  });
  expect(["High", "Critical"]).toContain(ai.priority);
});

it("drops a live-risk claim that nothing in the report supports", async () => {
  const { enforceAtRisk } = await import("./guardrails");
  expect(enforceAtRisk(true, renovation)).toBeUndefined();
  expect(enforceAtRisk(true, "a member slipped and hurt her wrist")).toBe(true);
  // Never invents risk where the model said there was none.
  expect(enforceAtRisk(false, "a member slipped")).toBe(false);
});

it("does not ask whether scheduled work is resolved yet", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      classification: {
        category: "Repair and Maintenance",
        subcategory: "Planned Closure / Renovation",
        confidence: 0.9,
        alternates: [],
      },
      slots: { studio: { value: "Bandra" }, raisedFor: { value: "Noticed by staff" } },
    }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: renovation }, ctx);
  expect(out.state.data.plannedWork).toBe(true);
  expect(out.state.data.plannedWindow).toBe("From 14th for 10 days");
  const asked = (out.state.agentAskLog ?? []).map((a) => a.ask).join(" ");
  expect(asked).not.toMatch(/resolved|still happening/i);
});

/* ------------------------------------------------------------------ */
/* Momence pickers replace guessing                                     */
/* ------------------------------------------------------------------ */

it("offers a multi-select session picker rather than guessing the classes", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(true);
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      slots: {
        studio: { value: "Kemps Corner" },
        raisedFor: { value: "Noticed by staff" },
        resolvedNow: { value: false },
        occurredAt: { value: "Earlier today" },
        frequency: { value: "First time" },
      },
    }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: outage }, ctx);
  expect(out.state.pendingQuestionId).toBe("sessions");
  expect(out.messages[0].picker).toBe("sessions");
});

it("upgrades the model's own class question to the timetable picker", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(true);
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      readyForDraft: false,
      // The model asked the right thing; it just had a text box to answer into.
      nextQuestion: { id: "custom:which_class", ask: "Which class was worst hit?" },
      slots: { studio: { value: "Kemps Corner" } },
    }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: outage }, ctx);
  // The acknowledgement the reporter watched stream in leads the message.
  expect(out.messages[0].content).toContain("Which class was worst hit?");
  expect(out.messages[0].picker).toBe("sessions");
  expect(out.state.pendingQuestionId).toBe("sessions");
});

it("does not offer a session picker when Momence is unavailable", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(emptyState(), [], { text: outage }, ctx);
  expect(out.state.agentAsked ?? []).not.toContain("sessions");
});

it("records every picked session and moves on to the roster", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(true);
  const s = emptyState();
  s.step = "agent_q";
  s.data = {
    rawText: outage,
    studioName: "Kwality House, Kemps Corner",
    studioId: 1,
    resolvedNow: false,
  };
  s.agentAsked = ["sessions"];
  s.pendingQuestionId = "sessions";

  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(
    s,
    [],
    { value: "sessions:101|Barre Beyond Basics · 10:00 am;;102|Power Cycle · 10:30 am" },
    ctx,
  );
  expect(out.state.data.momenceSessionIds).toEqual([101, 102]);
  expect(out.state.data.classInfo).toBe("Barre Beyond Basics · 10:00 am; Power Cycle · 10:30 am");
  // Real session ids beat anything parsed from prose, so they are human-set.
  expect(out.state.slotSources?.classInfo).toBe("user");
  expect(out.state.pendingQuestionId).toBe("attendees");
  expect(out.messages[0].picker).toBe("attendees");
});

it("takes the affected members from the roster instead of inferring a blast radius", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(true);
  const s = emptyState();
  s.step = "agent_q";
  s.data = {
    rawText: outage,
    studioName: "Kwality House, Kemps Corner",
    studioId: 1,
    momenceSessionIds: [101, 102],
    resolvedNow: false,
    occurredAt: "Earlier today",
    frequency: "First time",
    raisedFor: "Noticed by staff",
  };
  s.agentAsked = ["sessions", "attendees"];
  s.pendingQuestionId = "attendees";

  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(s, [], { value: "members:55|Anita Rao;;56|Dev Shah" }, ctx);
  expect(out.state.data.affectedMembers).toBe("Anita Rao, Dev Shah");
  expect(out.state.data.impact).toBe("many");
  expect(out.state.slotSources?.impact).toBe("user");
});

it("records one picked attendee as a single-member impact", async () => {
  const s = emptyState();
  s.step = "agent_q";
  s.data = { rawText: outage, momenceSessionIds: [102] };
  s.pendingQuestionId = "attendees";
  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(s, [], { value: "members:55|Anita Rao" }, ctx);
  expect(out.state.data.impact).toBe("single");
  expect(out.state.data.memberName).toBe("Anita Rao");
});

it("accepts 'nobody specific' without inventing an impact", async () => {
  const s = emptyState();
  s.step = "agent_q";
  s.data = { rawText: outage, momenceSessionIds: [102] };
  s.pendingQuestionId = "attendees";
  vi.mocked(runAgent).mockResolvedValue({ ok: true, latencyMs: 0, turn: turn() });
  const out = await runAgentTurn(s, [], { value: "members:none" }, ctx);
  expect(out.state.data.affectedMembers).toBe("None specifically identified");
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

/* ------------------------------------------------------------------ */
/* A thin report is questioned, and the reply the reporter watched      */
/* stream in is not thrown away                                         */
/* ------------------------------------------------------------------ */

const thin = "The mic in studio 2 doesn't work";

it("keeps the streamed acknowledgement in front of the question it asked", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      readyForDraft: false,
      reply: "That's a live one, Jimmeey.",
      nextQuestion: { id: "custom:symptom", ask: "What exactly is the mic doing?" },
      slots: { studio: { value: "Kemps Corner" } },
    }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: thin }, ctx);
  expect(out.messages[0].content).toContain("That's a live one, Jimmeey.");
  expect(out.messages[0].content).toContain("What exactly is the mic doing?");
});

it("asks the model's extras in the same breath as its question", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      readyForDraft: false,
      nextQuestion: { id: "custom:symptom", ask: "What exactly is the mic doing?" },
      followUps: [
        { id: "occurredAt", ask: "When did it start?" },
        { id: "frequency", ask: "Has it happened before?" },
      ],
      slots: { studio: { value: "Kemps Corner" } },
    }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: thin }, ctx);
  expect(out.messages[0].content).toContain("When did it start?");
  expect(out.messages[0].content).toContain("Has it happened before?");
});

it("will not let a one-line fault report go straight to the draft", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  // The model decided a one-liner was enough. It is not: the owner cannot tell
  // what is wrong with the mic, or whether classes are running without it.
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({ slots: { studio: { value: "Kemps Corner" }, impact: { value: "single" }, resolvedNow: { value: false } } }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: thin }, ctx);
  expect(out.state.step).toBe("agent_q");
  expect(out.state.pendingQuestionId).toBe("custom:symptom");
  expect(out.messages[0].options?.length).toBeGreaterThan(2);
});

it("does not interrogate a short report that already carries the detail", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      slots: {
        studio: { value: "Kemps Corner" }, impact: { value: "single" }, resolvedNow: { value: false },
        occurredAt: { value: "This morning" }, actionTaken: { value: "Swapped the batteries" },
      },
    }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: thin }, ctx);
  expect(out.state.step).toBe("review");
});

/* ------------------------------------------------------------------ */
/* The washing-machine transcript, 11 Sept                             */
/* ------------------------------------------------------------------ */

it("binds a studio the reporter typed rather than clicked", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    // The model did not put the studio in its slots — the typed answer must
    // still land, because the gate is in agentAsked and will never re-ask.
    turn: turn({ readyForDraft: false, nextQuestion: { id: "custom:symptom", ask: "What is it doing?" } }),
  });
  const s = emptyState();
  s.data.rawText = "the washing machine stopped working";
  s.data.category = "Repair and Maintenance";
  s.pendingQuestionId = "studio";
  s.agentAsked = ["studio"];
  const out = await runAgentTurn(s, [], { text: "Kwality House, Kemps Corner" }, ctx);
  expect(out.state.data.studioName).toBe("Kwality House, Kemps Corner");
  expect(out.state.data.studioId).toBe(1);
});

it("does not read 'still happening' as someone being in danger", () => {
  const ai = localEnrich({
    text: "the washing machine stopped working Kwality House, Kemps Corner Still happening",
    opening: "the washing machine stopped working",
    category: "Repair and Maintenance",
    subcategory: "General Maintenance Delays",
    studioName: "Kwality House, Kemps Corner",
    resolvedNow: false,
  });
  expect(ai.severity).not.toBe("Severe");
  expect(ai.priorityReason ?? "").not.toMatch(/immediate risk/i);
});

it("lets a stated single-member impact outrank the category's High baseline", () => {
  const ai = localEnrich({
    text: "the washing machine stopped working",
    opening: "the washing machine stopped working",
    category: "Repair and Maintenance",
    subcategory: "General Maintenance Delays",
    impact: "single",
    studioName: "Kwality House, Kemps Corner",
    resolvedNow: false,
  });
  expect(ai.priority).toBe("Medium");
});

it("titles the ticket with the problem, not the filing label", () => {
  const ai = localEnrich({
    text: "the washing machine stopped working Kwality House, Kemps Corner Still happening",
    opening: "the washing machine stopped working",
    category: "Repair and Maintenance",
    subcategory: "General Maintenance Delays",
    studioName: "Kwality House, Kemps Corner",
    resolvedNow: false,
  });
  expect(ai.title).toMatch(/washing machine/i);
  expect(ai.title).not.toBe("General Maintenance Delays (still unresolved)");
});

it("never follows a finished draft with a reply still asking for facts", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      reply: "The washing machine issue is ongoing, and I need to know where it's happening.",
      slots: {
        studio: { value: "Kemps Corner" }, impact: { value: "single" }, resolvedNow: { value: false },
        occurredAt: { value: "This morning" }, actionTaken: { value: "Reported to facilities" },
      },
    }),
  });
  const out = await runAgentTurn(emptyState(), [], { text: "the washing machine stopped working" }, ctx);
  expect(out.state.step).toBe("review");
  expect(out.messages.some((m) => /need to know/i.test(m.content))).toBe(false);
});

it("carries an extra the reporter never answered onto the ticket", async () => {
  vi.mocked(momenceAvailable).mockResolvedValue(false);
  // Turn 1: Iris asks for the studio and slips in "when did it start?".
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      readyForDraft: false,
      nextQuestion: { id: "studio", ask: "Which studio is this in?" },
      followUps: [{ id: "occurredAt", ask: "When did you first notice it?" }],
    }),
  });
  const asked = await runAgentTurn(emptyState(), [], { text: "the washing machine stopped working" }, ctx);
  expect(asked.state.agentAsked).toContain("occurredAt");
  expect(asked.messages[0].content).toContain("When did you first notice it?");

  // Turn 2: the reporter answers only the studio, and Iris drafts. The
  // abandoned extra must show up as an open item, not vanish.
  vi.mocked(runAgent).mockResolvedValue({
    ok: true,
    latencyMs: 0,
    turn: turn({
      slots: {
        impact: { value: "single" }, resolvedNow: { value: false },
        actionTaken: { value: "Reported it to facilities" },
        frequency: { value: "First time" }, notes: { value: "Drum will not spin" },
      },
    }),
  });
  const drafted = await runAgentTurn(asked.state, [], { text: "Kwality House, Kemps Corner" }, ctx);
  expect(drafted.state.step).toBe("review");
  expect(drafted.state.data.extraDetails?.["Still to confirm"]).toMatch(/first notice/i);
});
