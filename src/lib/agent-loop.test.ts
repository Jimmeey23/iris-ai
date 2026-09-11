import { beforeEach, expect, it, vi } from "vitest";
import { runAgent, type AgentContext } from "./agent";
import { chatWithTools, type RawToolCall, type ToolTurnResult } from "./llm";
import { runToolByName } from "./agent-tools";
import type { ChatMessage } from "./types";

vi.mock("./llm", async (original) => ({
  ...(await original<typeof import("./llm")>()),
  chatWithTools: vi.fn(),
}));
vi.mock("./agent-tools", async (original) => ({
  ...(await original<typeof import("./agent-tools")>()),
  runToolByName: vi.fn(async () => "id=101 Power Cycle · Thu, 11 Sept, 10:30 am · KV"),
}));

const ctx: AgentContext = {
  reporter: { name: "Jimmeey Gondaa", role: "Head of Sales" },
  studios: [{ id: 1, name: "Kwality House, Kemps Corner", city: "Mumbai", isHq: false }],
  known: {},
  asked: [],
  toolsEnabled: true,
};

const transcript: ChatMessage[] = [
  { id: "u1", role: "user", content: "The 10.30 cycle ran with no AC.", createdAt: new Date().toISOString() },
];

function call(name: string, args: unknown, id = "c1"): RawToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function reply(toolCalls: RawToolCall[], content = ""): ToolTurnResult {
  return { ok: true, toolCalls, content, model: "gpt-test", latencyMs: 1 };
}

const CLASSIFICATION = {
  category: "Repair and Maintenance",
  subcategory: "AC and HVAC Issues",
  confidence: 0.9,
  reason: "AC fault",
  alternates: [],
};

beforeEach(() => {
  vi.mocked(chatWithTools).mockReset();
  vi.mocked(runToolByName).mockClear();
});

it("lands a question turn from ask_reporter", async () => {
  vi.mocked(chatWithTools).mockResolvedValue(
    reply([
      call("ask_reporter", {
        reply: "Got it, Jimmeey.",
        question: { id: "resolvedNow", ask: "Is the AC back on?" },
        classification: CLASSIFICATION,
        slots: [{ id: "studio", value: "Kemps Corner", quote: "Kemps Corner" }],
      }),
    ]),
  );
  const out = await runAgent(transcript, ctx);
  expect(out.ok).toBe(true);
  expect(out.turn?.nextQuestion?.ask).toBe("Is the AC back on?");
  expect(out.turn?.readyForDraft).toBe(false);
  expect(out.turn?.slots.studio?.value).toBe("Kemps Corner");
});

it("lands a draft turn from file_ticket", async () => {
  vi.mocked(chatWithTools).mockResolvedValue(
    reply([
      call("file_ticket", {
        reply: "Here's the draft.",
        classification: CLASSIFICATION,
        slots: [{ id: "impact", value: "many" }],
        insight: {
          title: "AC failed during 10:30 am Power Cycle",
          summary: "The AC was out for the class.",
          rootCause: "HVAC unit underperforming.",
          suggestedAction: "Raise a vendor job.",
          priority: "High",
        },
      }),
    ]),
  );
  const out = await runAgent(transcript, ctx);
  expect(out.turn?.readyForDraft).toBe(true);
  expect(out.turn?.nextQuestion).toBeNull();
  expect(out.turn?.insight?.title).toBe("AC failed during 10:30 am Power Cycle");
});

it("treats a greeting as no report at all", async () => {
  vi.mocked(chatWithTools).mockResolvedValue(
    reply([call("invite_report", { reply: "Hey Jimmeey — what's happened?" })]),
  );
  const out = await runAgent(transcript, ctx);
  expect(out.turn?.reportEstablished).toBe(false);
  expect(out.turn?.readyForDraft).toBe(false);
  expect(out.turn?.nextQuestion).toBeNull();
});

it("runs a lookup, feeds the result back, and continues reasoning", async () => {
  vi.mocked(chatWithTools)
    .mockResolvedValueOnce(reply([call("find_sessions", { query: "cycle", date: "2026-09-11" })]))
    .mockResolvedValueOnce(
      reply([
        call("file_ticket", {
          reply: "Matched it to the real session.",
          classification: CLASSIFICATION,
          slots: [{ id: "momenceSessionId", value: "101" }],
          insight: {
            title: "AC failed during 10:30 am Power Cycle",
            summary: "s",
            rootCause: "r",
            suggestedAction: "a",
            priority: "High",
          },
        }),
      ]),
    );

  const out = await runAgent(transcript, ctx);
  expect(runToolByName).toHaveBeenCalledWith("find_sessions", { query: "cycle", date: "2026-09-11" });
  expect(out.turn?.slots.momenceSessionId?.value).toBe("101");

  // The second call must carry the tool result back as a real tool message, so
  // the agent reasons over what it found rather than over a pasted summary.
  const second = vi.mocked(chatWithTools).mock.calls[1][0];
  const toolMsg = second.messages.find((m) => m.role === "tool");
  expect(toolMsg).toBeDefined();
  expect((toolMsg as { content: string }).content).toContain("Power Cycle");
});

it("reports each lookup so the reporter sees what it is checking", async () => {
  vi.mocked(chatWithTools)
    .mockResolvedValueOnce(reply([call("find_sessions", { query: "cycle" })]))
    .mockResolvedValueOnce(
      reply([call("ask_reporter", {
        reply: "ok",
        question: { id: "impact", ask: "How many were in?" },
        classification: CLASSIFICATION,
        slots: [],
      })]),
    );
  const seen: string[] = [];
  await runAgent(transcript, ctx, { onLookup: (tool) => seen.push(tool) });
  expect(seen).toEqual(["find_sessions"]);
});

it("withdraws the lookups and forces a landing on the final step", async () => {
  // A model that only ever investigates must still produce a turn.
  vi.mocked(chatWithTools).mockResolvedValue(reply([call("find_sessions", { query: "cycle" })]));
  const out = await runAgent(transcript, ctx);
  expect(out.ok).toBe(false);

  const calls = vi.mocked(chatWithTools).mock.calls;
  const last = calls[calls.length - 1][0];
  expect(last.toolChoice).toBe("required");
  expect(last.tools.map((t) => t.name)).not.toContain("find_sessions");
  // The loop is bounded, so a spinning model cannot burn the session.
  expect(calls.length).toBeLessThanOrEqual(6);
});

it("does not offer lookup tools when Momence is disconnected", async () => {
  vi.mocked(chatWithTools).mockResolvedValue(
    reply([call("invite_report", { reply: "Tell me what happened." })]),
  );
  await runAgent(transcript, { ...ctx, toolsEnabled: false });
  const names = vi.mocked(chatWithTools).mock.calls[0][0].tools.map((t) => t.name);
  expect(names).toEqual(["invite_report", "ask_reporter", "file_ticket"]);
});

it("nudges a model that writes prose instead of landing the turn", async () => {
  vi.mocked(chatWithTools)
    .mockResolvedValueOnce(reply([], "I think this is an AC problem."))
    .mockResolvedValueOnce(
      reply([call("ask_reporter", {
        reply: "ok",
        question: { id: "impact", ask: "How many were in?" },
        classification: CLASSIFICATION,
        slots: [],
      })]),
    );
  const out = await runAgent(transcript, ctx);
  expect(out.ok).toBe(true);
  const second = vi.mocked(chatWithTools).mock.calls[1][0];
  expect(JSON.stringify(second.messages)).toMatch(/Land the turn now/);
});

it("fails cleanly when the transport fails", async () => {
  vi.mocked(chatWithTools).mockResolvedValue({ ok: false, toolCalls: [], error: "http-500", latencyMs: 1 });
  const out = await runAgent(transcript, ctx);
  expect(out.ok).toBe(false);
  expect(out.error).toBe("http-500");
});

it("survives a terminal call whose arguments are not valid JSON", async () => {
  vi.mocked(chatWithTools).mockResolvedValue(
    reply([{ id: "c1", type: "function", function: { name: "file_ticket", arguments: "{oops" } }]),
  );
  const out = await runAgent(transcript, ctx);
  expect(out.ok).toBe(false);
  expect(out.error).toBe("unparsable-terminal-call");
});

it("does not pay twice for the same lookup", async () => {
  vi.mocked(chatWithTools)
    .mockResolvedValueOnce(reply([call("find_sessions", { query: "cycle" }, "a1")]))
    // The model asks for the identical timetable again a step later.
    .mockResolvedValueOnce(reply([call("find_sessions", { query: "cycle" }, "a2")]))
    .mockResolvedValueOnce(
      reply([call("ask_reporter", {
        reply: "ok",
        question: { id: "impact", ask: "How many were in?" },
        classification: CLASSIFICATION,
        slots: [],
      })]),
    );
  await runAgent(transcript, ctx);
  expect(runToolByName).toHaveBeenCalledTimes(1);
});

it("reuses lookups already run before the turn started", async () => {
  vi.mocked(chatWithTools).mockResolvedValueOnce(
    reply([call("find_sessions", { date: "2026-09-11" })]),
  ).mockResolvedValueOnce(
    reply([call("ask_reporter", {
      reply: "ok",
      question: { id: "impact", ask: "How many?" },
      classification: CLASSIFICATION,
      slots: [],
    })]),
  );
  // The controller pre-fetches the timetable before the agent runs; asking for
  // it again must not hit Momence a second time.
  await runAgent(transcript, {
    ...ctx,
    toolResults: [
      { tool: "find_sessions", args: { date: "2026-09-11" }, result: "id=9 Prefetched · 10:00 am" },
    ],
  });
  expect(runToolByName).not.toHaveBeenCalled();
  const second = vi.mocked(chatWithTools).mock.calls[1][0];
  expect(JSON.stringify(second.messages)).toContain("Prefetched");
});
