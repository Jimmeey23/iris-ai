import { describe, expect, it } from "vitest";
import { EVAL_CASES, type EvalCase } from "./cases";
import { runAgent, type AgentContext } from "../agent";
import { momenceAvailable, runTools, type ToolResult } from "../agent-tools";
import { insightFromAgent } from "../enrich";
import { PRIORITIES, type Priority } from "../taxonomy";
import type { ChatMessage } from "../types";

/**
 * Live agent evals. Skipped unless OPENAI_API_KEY is set, so CI stays offline by
 * default:
 *
 *   OPENAI_API_KEY=sk-... npx vitest run src/lib/evals
 *
 * These call the real model, so they cost money and are mildly non-deterministic.
 * A failure means the prompt regressed on a case that used to pass.
 */

const HAS_KEY = (process.env.OPENAI_API_KEY ?? "").startsWith("sk-");

const STUDIOS = [
  { id: 1, name: "Kwality House, Kemps Corner", city: "Mumbai", isHq: false },
  { id: 2, name: "Supreme HQ, Bandra", city: "Mumbai", isHq: false },
  { id: 3, name: "Juhu", city: "Mumbai", isHq: false },
  { id: 9, name: "Head Office", city: "Mumbai", isHq: true },
];

function msg(role: "user" | "assistant", content: string): ChatMessage {
  return { id: `${role}${Math.random()}`, role, content, createdAt: new Date().toISOString() };
}

type RunOutcome = {
  questions: string[];
  lookups: string[];
  slots: Record<string, string>;
  category: string;
  subcategory: string;
  priority: Priority;
  narrative: string;
};

async function runCase(c: EvalCase, toolsEnabled: boolean): Promise<RunOutcome> {
  const transcript: ChatMessage[] = [msg("user", c.report)];
  const answers = [...(c.answers ?? [])];
  let nextAnswer = 0;
  const questions: string[] = [];
  const lookups: string[] = [];
  const toolResults: ToolResult[] = [];
  const slots: Record<string, string> = {};
  let category = "";
  let subcategory = "";
  let insightPriority: Priority = "Medium";

  for (let turn = 0; turn < 8; turn++) {
    const ctx: AgentContext = {
      reporter: { name: "Jimmeey Gondaa", role: "Head of Sales & Client Servicing" },
      studios: STUDIOS,
      known: { ...slots },
      asked: [...questions],
      relatedTickets: [],
      toolsEnabled,
      toolResults,
    };
    const res = await runAgent(transcript, ctx);
    expect(res.ok, `agent call failed: ${res.error}`).toBe(true);
    const t = res.turn!;

    category = t.classification.category;
    subcategory = t.classification.subcategory;
    for (const [k, v] of Object.entries(t.slots)) slots[k] = String(v.value);

    if (t.toolCalls?.length) {
      lookups.push(...t.toolCalls.map((call) => call.tool));
      toolResults.push(...(await runTools(t.toolCalls)));
      continue;
    }

    // A reporter volunteers things unprompted too. If the case still has
    // scripted turns left, deliver them before accepting the draft.
    if ((t.readyForDraft || !t.nextQuestion) && nextAnswer < answers.length) {
      transcript.push(msg("assistant", t.reply));
      transcript.push(msg("user", answers[nextAnswer++]));
      continue;
    }

    if (t.readyForDraft || !t.nextQuestion) {
      const insight = await insightFromAgent({
        agent: t.insight,
        text: transcript.filter((m) => m.role === "user").map((m) => m.content).join(" "),
        category,
        subcategory,
        impact: slots.impact,
        atRisk: slots.atRisk === "true",
        studioName: slots.studio,
      });
      insightPriority = insight.priority;
      return {
        questions,
        lookups,
        slots,
        category,
        subcategory,
        priority: insightPriority,
        narrative: `${insight.title} ${insight.summary} ${insight.rootCause}`.toLowerCase(),
      };
    }

    // Production never asks the same thing twice — mirror that here so a
    // re-ask shows up as a wasted turn rather than an infinite loop.
    const repeat = questions.includes(t.nextQuestion.id);
    if (!repeat) questions.push(t.nextQuestion.id);
    transcript.push(msg("assistant", t.nextQuestion.ask));
    transcript.push(
      msg(
        "user",
        repeat
          ? "I don't have that — just draft the ticket with what you have."
          : nextAnswer < answers.length
            ? answers[nextAnswer++]
            : "Nothing else, show me the draft.",
      ),
    );
  }

  throw new Error(`case ${c.id} never reached a draft`);
}

describe.skipIf(!HAS_KEY)("intake agent evals", () => {
  for (const c of EVAL_CASES) {
    it(
      c.id,
      async () => {
        // Lookups need a live Momence; without one the case still runs, minus
        // any mustLookUp assertions.
        const toolsEnabled = (c.expect.mustLookUp?.length ?? 0) > 0 ? await momenceAvailable() : false;
        const out = await runCase(c, toolsEnabled);
        const report = JSON.stringify(
          { category: out.category, subcategory: out.subcategory, priority: out.priority, questions: out.questions, lookups: out.lookups, slots: out.slots },
          null,
          2,
        );

        expect(c.expect.category, `category ${out.category}\n${report}`).toContain(out.category);

        if (c.expect.subcategoryLike) {
          const sub = out.subcategory.toLowerCase();
          expect(
            c.expect.subcategoryLike.some((k) => sub.includes(k.toLowerCase())),
            `subcategory "${out.subcategory}" matched none of ${c.expect.subcategoryLike.join(", ")}\n${report}`,
          ).toBe(true);
        }

        if (c.expect.minPriority) {
          expect(
            PRIORITIES.indexOf(out.priority),
            `priority ${out.priority} below min ${c.expect.minPriority}\n${report}`,
          ).toBeGreaterThanOrEqual(PRIORITIES.indexOf(c.expect.minPriority));
        }
        if (c.expect.maxPriority) {
          expect(
            PRIORITIES.indexOf(out.priority),
            `priority ${out.priority} above max ${c.expect.maxPriority}\n${report}`,
          ).toBeLessThanOrEqual(PRIORITIES.indexOf(c.expect.maxPriority));
        }

        expect(
          out.questions.length,
          `asked ${out.questions.length} questions (${out.questions.join(", ")}), budget ${c.expect.maxQuestions}\n${report}`,
        ).toBeLessThanOrEqual(c.expect.maxQuestions);

        if (c.expect.minQuestions) {
          expect(
            out.questions.length,
            `drafted after only ${out.questions.length} question(s) — an owner-critical gap was skipped\n${report}`,
          ).toBeGreaterThanOrEqual(c.expect.minQuestions);
        }

        if (c.expect.mustLookUp?.length && toolsEnabled) {
          for (const tool of c.expect.mustLookUp) {
            expect(out.lookups, `never called "${tool}" (called: ${out.lookups.join(", ") || "nothing"})\n${report}`).toContain(tool);
          }
        }

        for (const slot of c.expect.slotsFilled ?? []) {
          expect(slots(out, slot), `slot "${slot}" was never filled\n${report}`).toBe(true);
        }
        for (const slot of c.expect.mustNotAsk ?? []) {
          expect(out.questions, `should not have asked for "${slot}"\n${report}`).not.toContain(slot);
        }
        for (const phrase of c.expect.mustMention ?? []) {
          expect(
            out.narrative.includes(phrase.toLowerCase()),
            `ticket narrative never mentions "${phrase}"\n${out.narrative}`,
          ).toBe(true);
        }
      },
      120_000,
    );
  }
});

function slots(out: RunOutcome, slot: string): boolean {
  const v = out.slots[slot];
  return v !== undefined && v !== "" && v !== "null";
}
