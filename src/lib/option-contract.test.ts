import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { questionOptions, type AgentQuestion } from "./agent";
import { applyOptionAnswer } from "./agent-session";
import { buildQuestion, type SlotId } from "./dynamic-chat";
import {
  emptyState,
  handleInput,
  startSession,
  valueToWords,
  type EngineContext,
  type IntakeState,
} from "./chat-engine";
import { parseOptionValue, optionValueToWords } from "./slot-answers";
import type { ChatMessage } from "./types";

/**
 * A dead click is invisible in review: the value arrives, nothing recognises it,
 * the transcript stays empty and the field it was meant to fill keeps its old
 * value. That is exactly how the same bug shipped twice — the agent path
 * understood `ans:` while the questionnaire rendered `for:` / `loc:` / `sys:`.
 *
 * So this file does two things a unit test of one value cannot: it reads the
 * source for every option value the app can render, and it drives the real
 * renderers, then fails if any click ends up in a slot the parser does not
 * know, an empty utterance, or a silent no-op.
 */

const studios = [
  { id: 1, name: "Kwality House, Kemps Corner", code: "KC", city: "Mumbai", isHq: false },
  { id: 2, name: "Supreme HQ, Bandra", code: "BAN", city: "Mumbai", isHq: true },
];
const ctx: EngineContext = {
  studios,
  reporter: { name: "Jimmeey", role: "Head of Sales" },
};

/** Values the controller acts on itself rather than writing a slot. */
const CONTROL = /^(skip|unknown|showall|browse|restart|new|approve|retry|undo|edit(:|$)|confirm:|prio:|sessions:|members:)/;

function optionValues(messages: ChatMessage[]): string[] {
  return messages.flatMap((m) => (m.options ?? []).map((o) => o.value));
}

/* ------------------------------------------------------------------ */
/* 1. Source scan — every `value:` a ChatOption can carry              */
/* ------------------------------------------------------------------ */

/** Completions for template values (`value: \`cat:${c}\`` → the scanned head is "cat:"). */
const SAMPLE_TAIL: Record<string, string> = {
  "ans:": "Sample answer",
  "cat:": "Tech Issues",
  "sub:": "Mic Not Working",
  "studio:": "1",
  "prio:": "High",
  "confirm:alt:": "0",
  "edit:": "studio",
  "sessions:": "1,2",
  "members:": "1,2",
};

function scannerSources(): { file: string; value: string }[] {
  const root = join(process.cwd(), "src");
  const out: { file: string; value: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        const re = /label\s*:\s*[^,\n]+,\s*value\s*:\s*(?:"([^"\n]*)"|`([^`\n]*)`)/g;
        for (const match of text.matchAll(re)) {
          const raw = match[1] ?? match[2];
          // A template's static head, with the interpolated tail represented.
          if (raw.includes("${")) {
            const head = raw.split("${")[0];
            out.push({ file: relative(root, path), value: head });
          } else {
            out.push({ file: relative(root, path), value: raw });
          }
        }
      }
    }
  };
  walk(root);
  return out;
}

function concrete(head: string): string | null {
  if (head in SAMPLE_TAIL) return head + SAMPLE_TAIL[head];
  if (head.endsWith("|")) return `${head}Several members affected`;
  if (head === "" || head === "ans:") return "ans:Sample answer";
  return head;
}

describe("option contract — the source cannot emit an unanswerable click", () => {
  const scanned = scannerSources();

  it("scans the app for option values at all", () => {
    expect(scanned.length).toBeGreaterThan(40);
  });

  it("gives every value the app renders a meaning", () => {
    for (const { file, value } of scanned) {
      const sample = concrete(value);
      if (sample === null) continue;
      if (CONTROL.test(sample)) continue;
      const parsed = parseOptionValue(sample);
      expect(parsed.slot ?? parsed.label, `${file} renders ${JSON.stringify(value)} — no slot and no words`).toBeTruthy();
      expect(parsed.label.trim(), `${file} renders ${JSON.stringify(value)} — parses to nothing`).not.toBe("");
    }
  });

  it("renders no legacy prefix as a new value", () => {
    // The old vocabulary still *parses* (old sessions and cached clients carry
    // it) but nothing may render it any more — that mismatch is what swallowed
    // eight button values.
    const legacy = /^(for|class|loc|sys|when|impact|freq|risk|mem|membership):/;
    const offenders = scanned.filter(({ value }) => legacy.test(value));
    expect(offenders, offenders.map((o) => `${o.file}: ${o.value}`).join("\n")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Live scan — every question the renderers actually build          */
/* ------------------------------------------------------------------ */

describe("option contract — the renderers", () => {
  it("parses every profile question the questionnaire can build", () => {
    const slots: SlotId[] = [
      "studio", "raisedFor", "member", "memberContact", "trainer", "classInfo",
      "location", "systemAffected", "membershipRef", "occurredAt", "impact",
      "atRisk", "frequency", "actionTaken", "witnesses", "amount", "notes",
    ];
    const profiles = [
      { category: "Miscellaneous", subcategory: "General" },
      { category: "Tech Issues", subcategory: "Mic Not Working" },
      { category: "Repair and Maintenance", subcategory: "Power Outage / Utility Failure" },
      { category: "Theft and Lost Items", subcategory: "Locker Theft" },
      { category: "Safety and Security", subcategory: "Injury Prevention and Safety" },
    ];
    let checked = 0;
    for (const slot of slots) {
      for (const profile of profiles) {
        for (const option of buildQuestion(slot, profile).options ?? []) {
          expect(option.value, `${slot} in ${profile.subcategory} renders a legacy value`).toMatch(/^ans:/);
          const parsed = parseOptionValue(option.value, slot);
          expect(parsed.slot, `${option.value} names no slot`).toBe(slot);
          expect(parsed.label.trim(), `${option.value} has no words`).not.toBe("");
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("keeps the model's own question answerable, even for a custom ask", () => {
    const questions: AgentQuestion[] = [
      {
        id: "custom:request",
        ask: "What did Asha ask for?",
        // The model may write the value as a bare label, as a legacy prefix or
        // not at all — all three have to reach the reporter as answerable.
        options: [{ label: "A refund", value: "A refund" }, { label: "To cancel", value: "for:To cancel" }],
        skipLabel: "Not sure",
      },
      { id: "impact", ask: "How wide is the impact?", options: [{ label: "Several members affected", value: "ans:impact|Several members affected" }] },
      { id: "studio", ask: "Which studio?", options: [{ label: "Bandra", value: "Bandra" }] },
    ];
    for (const question of questions) {
      const options = questionOptions(question) ?? [];
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        expect(option.value).toMatch(/^ans:/);
        expect(optionValueToWords(option.value).trim(), `${option.value} has no words`).not.toBe("");
        const parsed = parseOptionValue(option.value, question.id);
        // A custom question has no field to write — its answer rides along as
        // words in the transcript, which is what the model reads next turn.
        if (!question.id.startsWith("custom:")) expect(parsed.slot).toBe(question.id);
        expect(parsed.label.trim()).not.toBe("");
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. Crawl — answer the questionnaire the way a reporter would         */
/* ------------------------------------------------------------------ */

describe("option contract — clicking through the deterministic questionnaire", () => {
  it("never dead-ends an option", () => {
    const seeds: { state: IntakeState; messages: ChatMessage[]; depth: number }[] = [
      { ...startSession(ctx), depth: 0 },
      { ...handleInput(emptyState(), { value: "browse" }, ctx), depth: 0 },
      { ...handleInput(emptyState(), { text: "The mic in studio 2 doesn't work" }, ctx), depth: 0 },
      { ...handleInput(emptyState(), { text: "No electricity at Kemps Corner for an hour yesterday evening." }, ctx), depth: 0 },
    ];
    let nodes = seeds;
    const seen = new Set<string>();
    let checked = 0;

    while (nodes.length && seen.size < 200) {
      const node = nodes.shift()!;
      const key = `${node.state.step}|${node.state.planIndex}|${JSON.stringify(node.state.data)}`;
      if (seen.has(key) || node.depth > 8) continue;
      seen.add(key);

      const values = optionValues(node.messages);
      if (!values.length) {
        // A free-text-only step still has to move: answer it like a human.
        const next = handleInput(node.state, { text: "It happened this morning in Studio 2, and nobody has looked at it yet." }, ctx);
        nodes.push({ state: next.state, messages: next.messages, depth: node.depth + 1 });
        continue;
      }

      for (const value of values) {
        checked += 1;
        const next = handleInput(node.state, { value }, ctx);
        // `approve` is the one value that answers by handing back a draft for
        // the API to create — everything else must say something.
        expect(next.messages.length > 0 || Boolean(next.createDraft), `${value} answers with nothing`).toBe(true);
        if (!CONTROL.test(value)) {
          // A click says something, names the slot it fills, and writes it.
          expect(valueToWords(value, { studios }).trim(), `${value} says nothing`).not.toBe("");
          const parsed = parseOptionValue(value, node.state.pendingQuestionId);
          expect(parsed.slot, `${value} is not understood by the parser`).toBeTruthy();
          const data = { ...node.state.data };
          const written = applyOptionAnswer(value, { ...node.state, data }, node.state.pendingQuestionId, studios);
          expect(written.slot, `${value} writes no slot`).toBeTruthy();
          const SLOT_FIELD: Record<string, string> = { studio: "studioName", member: "memberName", trainer: "trainerName" };
          const field = SLOT_FIELD[written.slot as string] ?? written.slot;
          expect(
            data.extraDetails !== undefined || (data as Record<string, unknown>)[field as string] !== undefined,
            `${value} writes nothing`,
          ).toBe(true);
        }
        nodes.push({ state: next.state, messages: next.messages, depth: node.depth + 1 });
      }
      nodes = nodes.slice(0, 24);
    }

    expect(checked, "the crawl never reached the questionnaire").toBeGreaterThan(20);
  });

  /**
   * The vocabulary an old session, a cached transcript or a third-party client
   * can still send. It must keep parsing — but it is never rendered again.
   */
  it("still understands the values older clients send", () => {
    const legacy = [
      "for:On behalf of a member", "class:Barre 57", "loc:Locker room", "sys:POS / card machine",
      "when:Just now", "impact:safety", "risk:yes", "risk:no", "freq:First time",
      "membership:20-class pack", "mem:Annual membership", "studio:none", "unknown",
      "session:141066997|Barre 57 · Fri, 4 Sept, 10:00 am|Neha Rao", "member:123|Priya Shah",
      "trainer:Neha", "cat:Class Experience", "sub:Audio Issues", "resolvedNow:yes", "resolvedNow:no",
    ];
    for (const value of legacy) {
      const parsed = parseOptionValue(value);
      expect(parsed.slot, `${value} no longer parses`).toBeTruthy();
      expect(optionValueToWords(value).trim(), `${value} has no words`).not.toBe("");
    }
    expect(parseOptionValue("risk:no").label).toBe("No");
    expect(parseOptionValue("impact:many").label).toBe("many");
  });
});
