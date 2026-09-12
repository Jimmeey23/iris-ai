import {
  buildDraft,
  handleInput,
  reviewMessage,
  startSession,
  assistantMessage,
  valueToWords,
  markSlotSource,
  slotSource,
  HUMAN_LOCKED_SLOTS,
  type EngineContext,
  type EngineInput,
  type EngineResult,
  type IntakeState,
  type SlotSource,
} from "./chat-engine";
import { CATEGORY_DEPARTMENT } from "./org";
import { CATEGORIES as CATEGORY_LIST, CATEGORY_META } from "./taxonomy";
import { applyComposerContext, inferFromText, IMPACT_LABEL } from "./chat-inference";
import { runAgent, generateSummary, questionOptions, type AgentContext, type AgentQuestion } from "./agent";
import {
  CANONICAL_SLOT_IDS,
  applySlotAnswer,
  impactKeyFromLabel,
  optionValueToWords,
  parseOptionValue as parseSharedOptionValue,
  type SlotAnswerData,
} from "./slot-answers";
import { profileFor, type SlotOverride } from "./question-bank";
import { missingRequired, normaliseRaisedFor, questionBudget } from "./guardrails";
import { issueKnowledgeBlock, suggestOwner } from "./issue-knowledge";
import { insightFromAgent } from "./enrich";
import { findRelatedTickets } from "./recurrence";
import { findContextFacts } from "./memory";
import { istDate, resolveWhenToDate, rowDateToIso } from "./time";
import { momenceAvailable, runTools, type ToolResult } from "./agent-tools";
import type { ChatMessage, ChatOption } from "./types";

/**
 * A message that is nothing but a greeting or a nudge. The model is told to
 * flag these itself, but a slip lets "hi" into the durable narrative — and from
 * there into the ticket title, which is how a ticket ends up called
 * "Hi HI, there was no electricity…". So the check is also made here, in code.
 */
const GREETING_ONLY =
  /^(?:h(?:i+|ey+|ello+)|yo+|hola|namaste|good\s+(?:morning|afternoon|evening|day)|morning|afternoon|evening|sup|hi there|hey there|are you (?:there|up)|you there|iris)[\s,.!?:;—–-]*$/i;

export function isGreetingOnly(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  // Strip a trailing "iris"/"team" address so "hi iris" counts too.
  const stripped = t.replace(/[\s,]+(?:iris|team|there)[\s,.!?]*$/i, "").trim();
  return GREETING_ONLY.test(t) || GREETING_ONLY.test(stripped);
}

/** Steps owned by the deterministic review / edit machinery, not the agent. */
const DETERMINISTIC_STEPS = new Set(["review", "edit_menu"]);
const DETERMINISTIC_VALUES = new Set(["approve", "edit", "restart", "new", "undo"]);

function isDeterministic(state: IntakeState, input: EngineInput): boolean {
  const value = input.value ?? "";
  // A reporter can correct or extend a draft in ordinary language. Those words
  // need the same extraction and correction pass as intake; only review buttons
  // belong to the deterministic UI state machine.
  if (state.step === "review" && input.text?.trim()) return false;
  return (
    DETERMINISTIC_STEPS.has(state.step) ||
    DETERMINISTIC_VALUES.has(value) ||
    value.startsWith("edit:") ||
    value.startsWith("prio:")
  );
}

/* ------------------------------------------------------------------ */
/* Structured input → state, and → words the agent can read            */
/* ------------------------------------------------------------------ */

/**
 * Option clicks and pickers, in two shapes: `ans:<slotId>|<label>` names the
 * slot explicitly (every renderer emits this now), and the legacy pre-agent
 * prefixes (`for:`, `class:`, `loc:`, `sys:`, `when:`, `impact:`, `risk:`,
 * `freq:`) are still understood — an option value that reaches the agent path
 * must never be a silent no-op. The mapping itself lives in `slot-answers`.
 */
function resolveOptionAnswer(
  value: string,
  pendingQuestionId?: string | null,
): { slot?: string; label: string } {
  return parseSharedOptionValue(value, pendingQuestionId);
}

function absorbExplicitAnswer(
  value: string,
  s: IntakeState,
  ctx: EngineContext,
  pendingQuestionId?: string | null,
): { slot?: string; label: string } | null {
  const result = resolveOptionAnswer(value, pendingQuestionId ?? s.pendingQuestionId ?? null);
  if (!result.slot) return null;
  const d = s.data;

  // Classification and studio have their own deterministic setters.
  if (result.slot === "category") {
    const canonical = CATEGORY_LIST.find((c) => c.toLowerCase() === result.label.trim().toLowerCase());
    if (!canonical) return { label: result.label };
    d.category = canonical;
    d.subcategory = undefined;
    markSlotSource(s, "category", "user");
    return { slot: "category", label: optionValueToWords(value) || result.label };
  }
  if (result.slot === "subcategory") {
    d.subcategory = result.label.trim();
    markSlotSource(s, "subcategory", "user");
    return { slot: "subcategory", label: optionValueToWords(value) || result.label };
  }
  if (result.slot === "studio") {
    if (/not studio/i.test(result.label)) {
      d.studioId = null;
      d.studioName = "Not studio specific";
    } else {
      // `studio:<id>` (the gate buttons) and `studio:<id>:<name>` (the picker)
      // carry a real id; a typed or model-written name is resolved instead.
      const byId = ctx.studios.find((st) => st.id === Number(result.label.trim()));
      const match = byId ?? resolveStudio(result.label, ctx.studios);
      if (!match) return { label: result.label };
      d.studioId = match.id;
      d.studioName = match.name;
    }
    markSlotSource(s, "studio", "user");
    return { slot: "studio", label: optionValueToWords(value, d.studioName) || result.label };
  }
  if (result.slot === "member") {
    const [, id, ...rest] = value.split(":");
    const numeric = Number(id);
    if (Number.isFinite(numeric) && rest.length > 0) {
      d.momenceMemberId = numeric;
      d.memberName = rest.join(":");
    } else {
      d.memberName = result.label;
    }
    markSlotSource(s, ["member", "momenceMemberId"], "user");
    return { slot: "member", label: `The member is ${d.memberName}.` };
  }
  if (result.slot === "classInfo" && value.startsWith("session:")) {
    const [, id, ...rest] = value.split(":");
    const [name, at, teacher] = rest.join(":").split("|");
    d.momenceSessionId = Number(id);
    d.classInfo = name;
    if (at) d.classAt = at;
    if (teacher && !d.trainerName) d.trainerName = teacher;
    markSlotSource(s, ["momenceSessionId", "classInfo"], "user");
    return {
      slot: "classInfo",
      label: `The class was ${[name, at, teacher && `taught by ${teacher}`].filter(Boolean).join(", ")}.`,
    };
  }

  const wrote = applySlotAnswer(result.slot, result.label, d as SlotAnswerData);
  // Only a write that actually happened may be recorded as human intent — the
  // old code marked the slot human-set even when the switch stored nothing.
  if (!wrote) return { slot: result.slot, label: result.label };
  markSlotSource(s, result.slot === "trainer" ? "trainerName" : result.slot, "user");
  return { slot: result.slot, label: optionValueToWords(value) || result.label };
}

/**
 * Apply an option click to state — the code path behind every tap. Exported for
 * the contract tests: a click must never be a silent no-op, and sentence-style
 * labels ("Yes — resolved") must parse to their slot values.
 */
export function applyOptionAnswer(
  value: string,
  s: IntakeState,
  pendingQuestionId?: string | null,
  studios: EngineContext["studios"] = [],
): { slot?: string; label: string } {
  const result = absorbExplicitAnswer(
    value,
    s,
    { studios, reporter: { name: "", role: "" } },
    pendingQuestionId,
  );
  if (result) return { slot: result.slot, label: result.label };
  return parseSharedOptionValue(value, pendingQuestionId);
}

/**
 * Picker and option clicks are applied deterministically *and* converted into a
 * plain-language utterance, so the transcript the agent reads is always the
 * complete conversation — never a set of opaque button ids.
 */
function absorbInput(
  input: EngineInput,
  s: IntakeState,
  ctx: EngineContext,
): { utterance: string; inferred: string[] } {
  const value = input.value ?? "";
  const text = (input.text ?? "").trim();
  const d = s.data;
  const inferred = input.context ? applyComposerContext(input.context, s) : [];

  const explicit = absorbExplicitAnswer(value, s, ctx);
  if (explicit) {
    return { utterance: explicit.label, inferred };
  }

  // Any other structured value — including a `custom:` answer with no field to
  // write — still has to become words. An empty utterance here is the silent
  // no-op that made clicks look ignored.
  const parsed = parseSharedOptionValue(value, s.pendingQuestionId ?? null);
  if (parsed.label) return { utterance: parsed.label, inferred };

  // Multi-select Momence answers. One incident routinely spans several classes,
  // so these carry the whole selection: "sessions:<id>|<label>;;<id>|<label>".
  // Real ids beat any text we parsed out of the report, so they are human-set.
  if (value.startsWith("sessions:")) {
    const rest = value.slice(9);
    markSlotSource(s, ["classInfo", "momenceSessionId"], "user");
    if (rest === "none" || !rest.trim()) {
      d.momenceSessionIds = [];
      return { utterance: "None of those classes were the ones affected.", inferred };
    }
    const picked = rest
      .split(";;")
      .map((part) => {
        const [id, ...label] = part.split("|");
        return { id: Number(id), label: label.join("|").trim() };
      })
      .filter((p) => Number.isFinite(p.id) && p.label);
    if (picked.length) {
      d.momenceSessionIds = picked.map((p) => p.id);
      d.momenceSessionId = picked[0].id;
      d.classInfo = picked.map((p) => p.label).join("; ");
      return {
        utterance: `The classes affected were ${d.classInfo}.`,
        inferred,
      };
    }
  }

  if (value.startsWith("members:")) {
    const rest = value.slice(8);
    markSlotSource(s, ["affectedMembers", "impact"], "user");
    if (rest === "none" || !rest.trim()) {
      d.affectedMembers = "None specifically identified";
      return { utterance: "No specific members need following up.", inferred };
    }
    const names = rest
      .split(";;")
      .map((part) => part.split("|").slice(1).join("|").trim())
      .filter(Boolean);
    if (names.length) {
      d.affectedMembers = names.join(", ");
      // A real roster count is the honest blast radius — no more guessing.
      d.impact = names.length > 1 ? "many" : "single";
      if (names.length === 1 && !d.memberName) d.memberName = names[0];
      return {
        utterance: `${names.length} member${names.length === 1 ? "" : "s"} affected: ${d.affectedMembers}.`,
        inferred,
      };
    }
  }

  if (value === "skip") return { utterance: "Skip that one.", inferred };
  if (value === "browse") return { utterance: "Let me pick the category myself.", inferred };

  return { utterance: text, inferred };
}

const TEXT_ANSWER_SLOTS = new Set([
  "member", "memberContact", "trainer", "classInfo", "location",
  "systemAffected", "membershipRef", "occurredAt", "frequency",
  "actionTaken", "witnesses", "amount", "notes",
]);

/** Bind a direct typed reply to the question it answers before asking the model
 * to reason further. The model can still refine it, but cannot accidentally
 * omit the answer from structured state. */
const DECLINED_ANSWER = /^(skip|pass|don'?t know|dunno|no idea|not sure|unknown|n\/a|not applicable)[.!]?$/i;

function bindPendingTextAnswer(text: string, s: IntakeState, ctx: EngineContext): void {
  const pending = s.pendingQuestionId;
  const answer = text.trim();
  if (!pending || !answer) return;
  if (DECLINED_ANSWER.test(answer)) {
    // "Not sure" is not agreement. When we asked the reporter to confirm a blast
    // radius the model had merely inferred, an unknown answer must drop that
    // guess rather than let it go on driving severity and the SLA clock — the
    // whole point of asking was that we did not trust it.
    if (pending === "impact" && slotSource(s, "impact") === "agent") {
      s.data.impact = undefined;
      s.data.extraDetails = {
        ...(s.data.extraDetails ?? {}),
        "Members affected": "Reporter could not confirm a count at intake",
      };
    }
    return;
  }
  if (pending === "resolvedNow") {
    if (/^(yes|resolved|fixed|restored|back)\b/i.test(answer)) s.data.resolvedNow = true;
    else if (/^(no|still|not|unresolved)\b/i.test(answer)) s.data.resolvedNow = false;
    else return;
  } else if (pending === "impact") {
    if (!applySlotAnswer("impact", answer, s.data as SlotAnswerData)) return;
  } else if (pending === "atRisk") {
    if (!applySlotAnswer("atRisk", answer, s.data as SlotAnswerData)) return;
  } else if (pending === "studio") {
    // The studio question renders buttons, so a click always worked — but a
    // reporter who types "Kwality House, Kemps Corner" was answering the same
    // question, and that reply used to bind to nothing. The gate never re-asks
    // (it is in agentAsked), so the studio silently stayed unknown all the way
    // to a ticket filed as "Not studio specific".
    const match = resolveStudio(answer, ctx.studios);
    if (!match) return;
    s.data.studioId = match.id;
    s.data.studioName = match.name;
  } else if (TEXT_ANSWER_SLOTS.has(pending)) {
    applySlotAnswer(pending, answer, s.data as SlotAnswerData);
  } else {
    return;
  }
  markSlotSource(s, pending === "trainer" ? "trainerName" : pending, "user");
  if (pending === "studio") markSlotSource(s, "studioName", "user");
}

/* ------------------------------------------------------------------ */
/* Agent slots → intake data                                           */
/* ------------------------------------------------------------------ */

/**
 * Match whatever the agent called the studio against the real studio list.
 *
 * Staff and models both write the locality only — "Kemps Corner", "Bandra",
 * "Kemps Corner (Mumbai)" — while the record is "Kwality House, Kemps Corner".
 * Compare on distinctive words rather than on the whole string.
 */
export function resolveStudio(
  value: string,
  studios: EngineContext["studios"],
): EngineContext["studios"][number] | null {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const said = norm(value);
  if (!said) return null;

  const generic = new Set(["mumbai", "bengaluru", "bangalore", "india", "studio", "house", "hq", "centre", "center", "the", "supreme", "support"]);
  const saidWords = new Set(said.split(" ").filter((w) => w.length > 2 && !generic.has(w)));

  let best: { studio: EngineContext["studios"][number]; score: number } | null = null;
  for (const studio of studios) {
    const name = norm(studio.name);
    let score = 0;
    if (said === name) score = 100;
    else if (said.includes(name) || name.includes(said)) score = 50;
    // A studio row with no short code must not take the whole turn down.
    if (studio.code && norm(studio.code) === said) score = Math.max(score, 90);

    for (const word of name.split(" ")) {
      if (word.length > 2 && !generic.has(word) && saidWords.has(word)) score += 10;
    }
    if (score > 0 && (!best || score > best.score)) best = { studio, score };
  }
  return best && best.score >= 10 ? best.studio : null;
}

function applySlots(
  slots: Record<string, { value: string | boolean | null }>,
  s: IntakeState,
  ctx: EngineContext,
  allowOverwrite = false,
): void {
  const d = s.data;
  const locked = (slot: string): boolean =>
    !allowOverwrite && (slotSource(s, slot) === "user" || slotSource(s, slot) === "context");

  for (const [slot, entry] of Object.entries(slots)) {
    const v = entry?.value;
    if (v === null || v === undefined || v === "") continue;
    const str = typeof v === "boolean" ? String(v) : v;
    const quote = (entry as { quote?: string }).quote?.trim();
    if (quote) s.slotQuotes = { ...(s.slotQuotes ?? {}), [slot]: quote.slice(0, 240) };

    switch (slot) {
      case "studio": {
        if (locked("studio") || (d.studioName !== undefined && !allowOverwrite)) break; // explicit context wins unless corrected
        const match = resolveStudio(str, ctx.studios);
        if (match) {
          d.studioId = match.id;
          d.studioName = `${match.name}, ${match.city}`;
        } else if (/not studio|all studios|n\/a/i.test(str)) {
          d.studioId = null;
          d.studioName = "Not studio specific";
        }
        break;
      }
      case "raisedFor": {
        if (locked("raisedFor")) break;
        d.raisedFor = normaliseRaisedFor(str);
        break;
      }
      case "member": if (locked("member")) break; d.memberName = str; break;
      case "memberContact": if (locked("memberContact")) break; d.memberContact = str; break;
      case "trainer": if (locked("trainerName")) break; d.trainerName = str; break;
      case "classInfo": {
        if (locked("classInfo")) break;
        // A session resolved against Momence outranks the reporter's shorthand.
        if (d.momenceSessionId && d.classInfo && !allowOverwrite) break;
        if (allowOverwrite) {
          d.momenceSessionId = undefined;
          d.momenceContext = undefined;
          s.autoLookupDone = false;
        }
        d.classInfo = str;
        break;
      }
      case "location": {
        if (locked("location")) break;
        // The studio itself is not an area within the studio.
        if (resolveStudio(str, ctx.studios)) break;
        d.location = str;
        break;
      }
      case "systemAffected": if (locked("systemAffected")) break; d.systemAffected = str; break;
      case "membershipRef": if (locked("membershipRef")) break; d.membershipRef = str; break;
      case "occurredAt": if (locked("occurredAt")) break; d.occurredAt = str; break;
      case "impact": {
        if (locked("impact")) break;
        const key = ["safety", "many", "single", "suggestion"].find((k) => str.toLowerCase().includes(k));
        if (key) d.impact = key;
        break;
      }
      case "atRisk":
        if (locked("atRisk")) break;
        d.atRisk = v === true || /^(true|yes)$/i.test(str);
        break;
      case "plannedWork": {
        if (locked("plannedWork")) break;
        const isPlanned = v === true || /^(true|yes)$/i.test(str);
        d.plannedWork = isPlanned;
        // Scheduled work has no live state. Clearing these stops a stale
        // "still happening" from an earlier turn compressing the SLA clock on
        // a ticket about work that has not started.
        if (isPlanned) {
          d.resolvedNow = undefined;
          d.atRisk = undefined;
        }
        break;
      }
      case "resolvedNow": {
        if (locked("resolvedNow")) break;
        if (typeof v === "boolean") d.resolvedNow = v;
        else if (/^(true|yes|resolved|fixed|it'?s fine)/i.test(str.trim())) d.resolvedNow = true;
        else if (/^(false|no|not resolved|still)/i.test(str.trim())) d.resolvedNow = false;
        break;
      }
      case "frequency": if (locked("frequency")) break; d.frequency = str; break;
      case "actionTaken": d.actionTaken = str; break;
      case "witnesses": d.witnesses = str; break;
      case "amount": d.amount = str; break;
      case "notes": d.notes = str; break;
      case "momenceSessionId": {
        if (locked("momenceSessionId")) break;
        const id = Number(str);
        if (Number.isFinite(id) && id > 0) d.momenceSessionId = id;
        break;
      }
      case "momenceMemberId": {
        if (locked("momenceMemberId")) break;
        const id = Number(str);
        if (Number.isFinite(id) && id > 0) d.momenceMemberId = id;
        break;
      }
      default: {
        if (slot.startsWith("custom:")) {
          const label = slot
            .slice(7)
            .replace(/[_-]+/g, " ")
            .replace(/^\w/, (c) => c.toUpperCase());
          d.extraDetails = { ...(d.extraDetails ?? {}), [label]: str };
        }
      }
    }
  }
}

/**
 * Apply explicit model-reported corrections. These are the one channel that may
 * overwrite human-locked slots, because each correction names the slot the
 * reporter revised. Corrected values re-lock to the human side: the reporter's
 * newest word is their word.
 */
function applyCorrections(
  corrections: { slot: string; value: string; quote?: string }[] | undefined,
  s: IntakeState,
  ctx: EngineContext,
): void {
  if (!corrections?.length) return;
  for (const c of corrections) {
    const slot = c.slot.trim();
    if (!slot || c.value === undefined || c.value === null || String(c.value).trim() === "") continue;
    if (slot.startsWith("custom:")) {
      const label = slot
        .slice(7)
        .replace(/[_-]+/g, " ")
        .replace(/^\w/, (ch) => ch.toUpperCase());
      s.data.extraDetails = { ...(s.data.extraDetails ?? {}), [label]: String(c.value) };
      continue;
    }
    const wrapper: Record<string, { value: string | boolean | null; quote?: string }> = {
      [slot]: { value: c.value, quote: c.quote },
    };
    applySlots(wrapper, s, ctx, true);
    const sourceKey = slot === "trainer" ? "trainerName" : slot;
    markSlotSource(s, sourceKey, "user");
    // Identity and schedule facts carry dependent lookup data. A correction to
    // their human-readable value invalidates the old linked record atomically.
    if (slot === "studio" || slot === "occurredAt") {
      s.data.momenceSessionId = undefined;
      s.data.momenceContext = undefined;
      s.autoLookupDone = false;
    }
    if (slot === "member") {
      s.data.momenceMemberId = undefined;
      s.data.memberContact = undefined;
      s.data.membershipRef = undefined;
      s.memberLookupDone = false;
    }
  }
}

/** Merge the facts from one reasoning pass before another pass or lookup runs.
 * This guarantees later model calls receive everything already extracted from
 * the conversation, including corrections. */
function applyTurnFacts(turn: { slots: Record<string, { value: string | boolean | null }>; corrections?: { slot: string; value: string; quote?: string }[] }, s: IntakeState, ctx: EngineContext): void {
  applyCorrections(turn.corrections, s, ctx);
  const corrected = new Set(
    (turn.corrections ?? []).map((c) => c.slot === "trainer" ? "trainerName" : c.slot),
  );
  const uncorrectedSlots = Object.fromEntries(
    Object.entries(turn.slots).filter(([slot]) => !corrected.has(slot === "trainer" ? "trainerName" : slot)),
  );
  const before: Record<string, unknown> = { ...s.data };
  applySlots(uncorrectedSlots, s, ctx, false);
  // Record that these values are the model's reading, not the reporter's word.
  // Without this every slot looks equally authoritative, and a downstream check
  // cannot tell an inference it should confirm from a fact it should trust.
  for (const [key, value] of Object.entries(s.data)) {
    if (value === undefined || value === before[key]) continue;
    const mapped = key === "trainerName" ? "trainerName" : key;
    if (slotSource(s, mapped) === "user" || slotSource(s, mapped) === "context") continue;
    markSlotSource(s, mapped, "agent");
  }
}

/**
 * A Momence session search built from whatever the reporter named, or null when
 * nothing class-shaped was mentioned and a lookup would be noise.
 */
function sessionQuery(
  s: IntakeState,
  slots: Record<string, { value: string | boolean | null }>,
  studios: EngineContext["studios"],
): { query?: string; date?: string; locationId?: number } | null {
  const classInfo = String(slots.classInfo?.value ?? s.data.classInfo ?? "").trim();
  if (!classInfo || /not class specific/i.test(classInfo)) return null;

  // Strip clock times — Momence matches on the class name, not "10.30am".
  const query = classInfo
    .replace(/\b\d{1,2}[.:]?\d{0,2}\s?(am|pm)\b/gi, " ")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (query.length < 3) return null;

  // Resolve the reported day on the IST calendar — the same clock the agent
  // prompt reasons with. "Today" at 1am IST must search today, not yesterday.
  const occurred = String(slots.occurredAt?.value ?? s.data.occurredAt ?? "");
  const date = resolveWhenToDate(occurred);

  const locationId = studios.find((st) => st.id === s.data.studioId)?.momenceLocationId ?? undefined;

  // Several classes named at once means no single search term fits — pull the
  // day's timetable for that studio instead and let the agent match them up.
  const multiple = /,| and /i.test(classInfo);
  if (multiple && date) return { date, locationId: locationId ?? undefined };

  return { query: query.split(" ").slice(0, 4).join(" "), date, locationId: locationId ?? undefined };
}

/**
 * Whether the text talks about a class at all — clock times, class formats
 * (including studio shorthand like "BBB"), or the words class/session/workout.
 * Gates the timetable pre-fetch so billing reports never pay for one.
 */
export function hasClassSignal(text: string): boolean {
  return /\b(class|session|workout|barre|mat|power\s?cycle|cycle|fit|bbb|sculpt|strength( lab)?|private)\b|\b\d{1,2}[.:]?\d{0,2}\s?(am|pm)\b/i.test(
    text,
  );
}

export type SessionRow = { id: number; label: string; time: string | null };

/** Parse the `id=… Name · Fri, 4 Sept, 7:15 pm · Teacher` rows a lookup returns. */
export function parseSessionRows(result: string): SessionRow[] {
  return result
    .split("\n")
    .map((line) => {
      const id = Number(line.match(/^id=(\d+)/)?.[1]);
      if (!Number.isFinite(id)) return null;
      const label = line.replace(/^id=\d+\s*/, "").trim();
      const time = label.match(/\b(\d{1,2}):(\d{2})\s?(am|pm)\b/i)?.[0] ?? null;
      return { id, label, time };
    })
    .filter((row): row is SessionRow => row !== null);
}

/** Clock times mentioned by the reporter, normalised to "h:mm am/pm". */
export function reportedTimes(text: string): string[] {
  const found = [...text.matchAll(/\b(\d{1,2})[.:]?(\d{2})?\s?(am|pm)\b/gi)];
  return found.map((m) => `${Number(m[1])}:${m[2] ?? "00"} ${m[3].toLowerCase()}`);
}

function normaliseTime(value: string): string {
  const m = value.match(/(\d{1,2}):(\d{2})\s?(am|pm)/i);
  return m ? `${Number(m[1])}:${m[2]} ${m[3].toLowerCase()}` : value.toLowerCase();
}

/**
 * Pick the session a report is talking about, but only when it is beyond doubt:
 * exactly one row whose start time matches a time the reporter gave, or a single
 * row overall — and, when the report day is known, only rows from that day.
 * Anything ambiguous is left for the agent (or the reporter) to resolve — a
 * wrong session id on a ticket is worse than no session id.
 */
export function matchSession(
  rows: SessionRow[],
  reportText: string,
  occurredAtIso?: string,
): SessionRow | null {
  if (rows.length === 0) return null;

  // Date agreement first: a session on another day is never the one reported,
  // however well the clock time lines up. When the rows carry readable dates
  // and none match the reported day, there is simply no candidate.
  let candidates = rows;
  if (occurredAtIso) {
    const dated = rows.filter((row) => rowDateToIso(row.label) !== undefined);
    if (dated.length > 0) candidates = dated.filter((row) => rowDateToIso(row.label) === occurredAtIso);
  }

  const times = new Set(reportedTimes(reportText));
  if (times.size > 0) {
    const hits = candidates.filter((row) => row.time && times.has(normaliseTime(row.time)));
    return hits.length === 1 ? hits[0] : null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function knownForAgent(s: IntakeState): {
  known: Record<string, string>;
  humanLocked: string[];
  quotes: Record<string, string>;
} {
  const d = s.data;
  const known: Record<string, string> = {};
  const humanLocked: string[] = [];
  const put = (k: string, v: unknown, humanKey?: string) => {
    if (v !== undefined && v !== null && v !== "") {
      known[k] = String(v);
      const src = slotSource(s, humanKey ?? k);
      if (src === "user" || src === "context") humanLocked.push(k);
    }
  };
  put("studio", d.studioName);
  put("raisedFor", d.raisedFor);
  put("category", d.category ? (d.subcategory ? `${d.category} › ${d.subcategory}` : d.category) : undefined);
  put("member", d.memberName);
  put("memberContact", d.memberContact);
  put("trainer", d.trainerName, "trainerName");
  put("classInfo", d.classInfo);
  put("momenceSessionId", d.momenceSessionId);
  put("momenceMemberId", d.momenceMemberId);
  put("classAt", d.classAt);
  put("location", d.location);
  put("systemAffected", d.systemAffected);
  put("membershipRef", d.membershipRef);
  put("occurredAt", d.occurredAt);
  put("impact", d.impact ? (IMPACT_LABEL[d.impact] ?? d.impact) : undefined);
  put("atRisk", d.atRisk);
  put(
    "resolvedNow",
    d.resolvedNow !== undefined ? (d.resolvedNow ? "yes — resolved/fixed" : "no — still happening") : undefined,
  );
  put("frequency", d.frequency);
  put("actionTaken", d.actionTaken);
  put("witnesses", d.witnesses);
  put("amount", d.amount);
  put("notes", d.notes);
  for (const [k, v] of Object.entries(d.extraDetails ?? {})) put(k, v);
  return { known, humanLocked, quotes: { ...(s.slotQuotes ?? {}) } };
}

/* ------------------------------------------------------------------ */
/* Question rendering                                                  */
/* ------------------------------------------------------------------ */

function studioOptions(ctx: EngineContext): ChatOption[] {
  const opts: ChatOption[] = ctx.studios
    .filter((st) => !st.isHq)
    .map((st) => ({ label: st.name, value: `studio:${st.id}`, hint: st.city }));
  const hq = ctx.studios.find((st) => st.isHq);
  if (hq) opts.push({ label: hq.name, value: `studio:${hq.id}`, hint: hq.city });
  opts.push({ label: "Not studio specific", value: "studio:none", tone: "ghost" });
  return opts;
}

/* ------------------------------------------------------------------ */
/* Fallback questions — curated per issue, never a device-symptom ladder */
/* ------------------------------------------------------------------ */

/**
 * Slots worth asking about when a report is too thin to action and the model
 * believes it is complete. The curated per-issue wording in `question-bank` is
 * tried first; this is the generic order behind it.
 */
const THIN_ASK_SLOTS = [
  "location", "systemAffected", "classInfo", "occurredAt", "frequency",
  "actionTaken", "witnesses", "amount", "impact", "memberContact",
] as const;

/** Plain wording for a slot the curated bank has nothing specific to say about. */
const THIN_ASK_WORDING: Record<string, string> = {
  location: "Where in the studio is it?",
  systemAffected: "Which piece of kit or system is it?",
  classInfo: "Which class or format did this affect?",
  occurredAt: "When did this start, and is it still the case now?",
  frequency: "Is this the first time, or has it happened before?",
  actionTaken: "Has anyone done anything about it yet?",
  witnesses: "Who else was there when it happened?",
  amount: "Is there a value or amount involved?",
  impact: "Who has this affected so far?",
  memberContact: "Is there a member this relates to, and the best way to reach them?",
};

/**
 * One question for a report that is genuinely too thin to act on.
 *
 * The previous ladder asked "is it dead, cutting out, distorted, or something
 * else?" of every thin report in six categories — including a stolen handbag,
 * because the ladder never read the report. This asks what the curated profile
 * for *this* issue says an owner needs, and returns nothing when the bank has
 * nothing better to offer than the model's own judgement. Falling back to the
 * draft is better than asking a question that makes no sense.
 */
function thinReportQuestion(s: IntakeState): AgentQuestion | null {
  const d = s.data;
  const profile = profileFor(d.category ?? "", d.subcategory ?? "");
  const dropped = new Set<string>(profile.dropSlots ?? []);
  const known: Record<string, unknown> = {
    location: d.location,
    systemAffected: d.systemAffected,
    classInfo: d.classInfo,
    occurredAt: d.occurredAt,
    frequency: d.frequency,
    actionTaken: d.actionTaken,
    witnesses: d.witnesses,
    amount: d.amount,
    impact: d.impact,
    memberContact: d.memberContact,
  };
  // The issue's own slots come first, in the order the bank's author listed
  // them: the subcategory's `slots` are the asks that define this issue — a mic
  // fault asks which piece of kit before it asks which room — then the softer
  // `extraSlots`, then the generic order. Asking the generic list first buries
  // the question that actually belongs to the issue.
  const candidates: string[] = [
    ...new Set<string>([...Object.keys(profile.slots ?? {}), ...(profile.extraSlots ?? []), ...THIN_ASK_SLOTS]),
  ];
  for (const slot of candidates) {
    if (dropped.has(slot)) continue;
    if (known[slot] !== undefined) continue;
    if ((s.agentAsked ?? []).includes(slot)) continue;
    const override = (profile.slots as Record<string, SlotOverride> | undefined)?.[slot];
    const ask = override?.prompt ?? THIN_ASK_WORDING[slot];
    if (!ask) continue;
    const options = override?.options?.map((label) => ({
      label,
      // Impact wording changes per issue but the stored key must not.
      value: slot === "impact" ? `ans:impact|${impactKeyFromLabel(label) ?? "many"}` : `ans:${slot}|${label}`,
    }));
    return {
      id: slot,
      ask,
      why: override?.helper,
      allowFreeText: true,
      placeholder: override?.placeholder,
      options,
    };
  }
  return null;
}

/**
 * A question card is the question and the ways to answer it — nothing else.
 *
 * It previously also carried an acknowledgement sentence, a why-line, a row of
 * green "detected" chips and a four-cell category/confidence grid, which buried
 * the actual question in the middle of the card and repeated facts the capture
 * panel already shows. Detected facts belong in that panel, not in the bubble.
 */
/**
 * The reporter watches the model's acknowledgement stream in, so throwing it
 * away and rendering the bare question is experienced as Iris typing one thing
 * and then replacing it with another. Lead with the words they already saw.
 */
function questionMessage(
  q: AgentQuestion,
  s: IntakeState,
  ctx: EngineContext,
  budget: number,
  lead?: string,
  followUps: { id: string; ask: string }[] = [],
): ChatMessage {
  const options = q.id === "studio" ? studioOptions(ctx) : questionOptions(q);
  const ack = (lead ?? "").trim();
  const ask = [q.ask, ...followUps.map((f) => f.ask.trim()).filter(Boolean)].join(" ");
  // A model that ignored the instruction and put the question in `reply` too
  // must not have it read back twice.
  const keepAck = ack && !ack.includes("?") && !ask.toLowerCase().includes(ack.toLowerCase());
  return assistantMessage(keepAck ? `${ack}\n\n${ask}` : ask, {
    options,
    allowFreeText: q.allowFreeText ?? true,
    placeholder: q.placeholder,
    picker: q.picker,
    remaining: Math.max(0, budget - (s.agentAsked?.length ?? 0)),
  });
}

function analysisChips(s: IntakeState, confidence: number): ChatMessage["analysis"] {
  const d = s.data;
  const category = d.category ?? "Miscellaneous";
  return [
    { label: "Category", value: `${CATEGORY_META[category]?.icon ?? "🎫"} ${category}` },
    { label: "Subcategory", value: d.subcategory ?? "—" },
    { label: "Confidence", value: `${Math.round(confidence * 100)}%` },
    { label: "Routing", value: CATEGORY_DEPARTMENT[category] ?? "Operations" },
  ];
}

/* ------------------------------------------------------------------ */
/* Turn                                                                */
/* ------------------------------------------------------------------ */

function firstName(ctx: EngineContext): string {
  return ctx.reporter.name.split(" ")[0] || "there";
}

export type AgentTurnResult = EngineResult & {
  usedAgent: boolean;
  degraded?: string;
  model?: string;
  /**
   * The reporter's turn as plain words — including option and picker clicks —
   * so the caller can persist a transcript the agent can re-read next turn.
   */
  userUtterance?: string;
  /** Set on a post-creation turn: the change to make to the live ticket. */
  intent?: PostCreationIntent;
};

/**
 * What a message sent after the ticket exists decided to do. The controller can
 * see it; the caller applies it (the engine layer has no database access, and
 * the mutation must be permission-checked against the session row that actually
 * raised the ticket).
 */
export type PostCreationIntent =
  | { kind: "amend"; ticketId: number; update: string; amendmentKind?: string; priority?: string }
  | { kind: "followup"; ticketId: number; title: string; summary: string; category: string; subcategory: string; priority?: string };

export type TurnHooks = {
  /** Progress notes for a streaming client: what the agent is doing right now. */
  onStatus?: (status: string) => void;
  /** Slices of the agent's reply, as it is written. */
  onReplyDelta?: (text: string) => void;
  /**
   * Fired before each model call. A turn that pauses for a Momence lookup calls
   * the model twice, so the client must discard the first partial reply.
   */
  onReplyRestart?: () => void;
};

/* ------------------------------------------------------------------ */
/* Life after the ticket exists                                        */
/* ------------------------------------------------------------------ */

type LiveTicket = { id: number; ticketNumber: string; title: string; status: string; studioName?: string };

/**
 * The ticket this session raised, read from its own transcript — the `created`
 * card carries the number, title and studio. Falls back to the state's id.
 */
function liveTicket(state: IntakeState, transcript: ChatMessage[]): LiveTicket | null {
  const card = [...transcript].reverse().find((m) => m.kind === "created" && m.created)?.created;
  const id = card?.id ?? state.createdTicketId;
  if (id == null) return null;
  return {
    id,
    ticketNumber: card?.ticketNumber ?? `ticket ${id}`,
    title: card?.title ?? state.data.category ?? "the ticket",
    status: "Open",
    studioName: card?.studioName ?? state.data.studioName,
  };
}

/**
 * One turn about a ticket that already exists.
 *
 * The model is handed the live ticket and may add an update to it, raise a
 * separate linked one, or simply answer. Whatever it chooses, the reporter's
 * words are never dropped: if the reasoning pass fails, the message is recorded
 * on the ticket as a plain update rather than met with an error.
 */
async function runPostCreationTurn(
  state: IntakeState,
  transcript: ChatMessage[],
  input: EngineInput,
  ctx: EngineContext,
  hooks: TurnHooks,
): Promise<AgentTurnResult> {
  const s: IntakeState = { ...state, data: { ...state.data } };
  const ticket = liveTicket(state, transcript);
  if (!ticket) return { ...handleInput(state, input, ctx), usedAgent: false };

  const utterance = input.text?.trim() || (input.value ? optionValueToWords(input.value) : "");
  const convo = [...transcript];
  if (utterance) {
    convo.push({
      id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      content: utterance,
      createdAt: new Date().toISOString(),
    });
  }

  const toolsEnabled = await momenceAvailable().catch(() => false);
  const { known, humanLocked, quotes } = knownForAgent(s);
  const recentOpenings = transcript
    .filter((m) => m.role === "assistant" && m.kind !== "draft" && m.content?.trim())
    .slice(-2)
    .map((m) => m.content.split(/\n|\. /)[0] ?? "");

  const agentCtx: AgentContext = {
    reporter: ctx.reporter,
    studios: ctx.studios.map((st) => ({ id: st.id, name: st.name, city: st.city, isHq: st.isHq })),
    known: {
      ...known,
      ticket: `${ticket.ticketNumber} — "${ticket.title}" (${ticket.status})`,
    },
    humanLocked,
    quotes,
    recentOpenings,
    asked: [],
    relatedTickets: [],
    memoryFacts: [],
    toolsEnabled,
    toolResults: s.toolResults,
    summaryCompression: s.contextSummary,
    sessionId: input.sessionId,
    ticket,
  };

  hooks.onStatus?.("Reading your update");
  hooks.onReplyRestart?.();
  const result = await runAgent(convo, agentCtx, {
    onReplyDelta: hooks.onReplyDelta,
    onLookup: (tool) => hooks.onStatus?.(`Checking ${tool.replace(/_/g, " ")} in Momence`),
  });

  s.step = "created";
  s.pendingQuestionId = null;

  const options: ChatOption[] = [{ label: "Raise another ticket", value: "new", tone: "ghost" }];

  // A failed reasoning pass is not a reason to lose a correction: the words go
  // onto the ticket as an update, and the reply says exactly that.
  if (!result.ok || !result.turn) {
    const update = utterance.trim();
    if (update) {
      s.agentFailures = 0;
      return {
        state: s,
        usedAgent: true,
        userUtterance: utterance,
        model: result.model,
        degraded: result.error ?? "agent-unavailable",
        intent: { kind: "amend", ticketId: ticket.id, update, amendmentKind: "addition" },
        messages: [
          assistantMessage(
            `Noted — I've added that to **${ticket.ticketNumber}** so it isn't lost. The reasoning service is unavailable right now, so I couldn't do more with it than record it.`,
            { allowFreeText: true, options },
          ),
        ],
      };
    }
    return {
      state: s,
      usedAgent: true,
      userUtterance: utterance,
      model: result.model,
      degraded: result.error ?? "agent-unavailable",
      messages: [
        assistantMessage(
          `I couldn't reach the reasoning service just now. **${ticket.ticketNumber}** is safe — try me again in a moment.`,
          { allowFreeText: true, options },
        ),
      ],
    };
  }

  const turn = result.turn;
  const amendment = turn.amendment?.update?.trim();
  const followUp = turn.followUpTicket?.title ? turn.followUpTicket : undefined;
  const intent: PostCreationIntent | undefined = amendment
    ? { kind: "amend", ticketId: ticket.id, update: amendment, amendmentKind: turn.amendment?.kind, priority: turn.amendment?.priority }
    : followUp
      ? {
          kind: "followup",
          ticketId: ticket.id,
          title: followUp.title,
          summary: followUp.summary,
          category: followUp.category,
          subcategory: followUp.subcategory,
          priority: followUp.priority,
        }
      : undefined;

  return {
    state: s,
    usedAgent: true,
    userUtterance: utterance,
    model: result.model,
    intent,
    messages: [
      assistantMessage(turn.reply.trim() || "Got it — I've noted that on the ticket.", {
        allowFreeText: true,
        options,
      }),
    ],
  };
}

export async function runAgentTurn(
  state: IntakeState,
  transcript: ChatMessage[],
  input: EngineInput,
  ctx: EngineContext,
  hooks: TurnHooks = {},
): Promise<AgentTurnResult> {
  if (input.value === "restart") {
    const fresh = startSession(ctx);
    return { ...fresh, usedAgent: false };
  }
  if (isDeterministic(state, input)) {
    return { ...handleInput(state, input, ctx), usedAgent: false };
  }

  // The ticket is already raised. Every further message used to be answered
  // with "This ticket is already raised. Start a new one below." — the one
  // moment a reporter most needs to say "actually it was Bandra, and the
  // vendor came at 4", answered with a refusal. A live ticket is a
  // conversation, so it gets one.
  if (state.step === "created" && liveTicket(state, transcript)) {
    return runPostCreationTurn(state, transcript, input, ctx, hooks);
  }

  const s: IntakeState = {
    ...state,
    data: { ...state.data },
    suggestions: [...state.suggestions],
    agentAsked: [...(state.agentAsked ?? [])],
    slotSources: { ...(state.slotSources ?? {}) },
    // An answer to an edit-menu question is an agent turn — the deterministic
    // edit machinery owns the field only while it is asking.
    editingField: null,
  };

  const { utterance, inferred } = absorbInput(input, s, ctx);
  // Match context fields on every message, not just the opening report. This
  // makes later volunteered details available before the model plans a question
  // or a Momence lookup.
  if (utterance) {
    bindPendingTextAnswer(utterance, s, ctx);
    const before = { ...s.data };
    inferred.push(...inferFromText(utterance, s, ctx));
    // Regex extraction is a GUESS, not the reporter's word. Marking it "user"
    // made it human-locked: the model could not correct it, the Momence matcher
    // could not replace it, and the controller suppressed any question about it
    // because the slot looked answered. That is why a mis-parsed class list
    // ("30AM", a room listed as a class) survived all the way to the ticket and
    // no session picker was ever offered.
    for (const [key, value] of Object.entries(s.data)) {
      if (value !== undefined && value !== before[key as keyof typeof before]) {
        markSlotSource(s, key === "trainerName" ? "trainerName" : key, "agent");
      }
    }
  }

  // Nothing was actually said — don't spend a model call on an empty turn.
  // A button whose words are empty ("Retry reasoning") still belongs to a
  // conversation that has a report in it, so the captured narrative counts too
  // — otherwise retrying restarts the reporter from "tell me what happened".
  const hasNarrative =
    utterance ||
    Boolean(s.data.rawText?.trim()) ||
    transcript.some((m) => m.role === "user" && m.content.trim());
  if (!hasNarrative) {
    return {
      state: s,
      usedAgent: false,
      messages: [
        assistantMessage(
          `Tell me what happened in your own words, ${firstName(ctx)} — I'll work out the rest and only ask about the gaps.`,
          { allowFreeText: true, placeholder: "What happened?" },
        ),
      ],
    };
  }

  const convo: ChatMessage[] = utterance
    ? [
        ...transcript,
        {
          id: `u${Date.now().toString(36)}`,
          role: "user",
          content: utterance,
          createdAt: new Date().toISOString(),
        },
      ]
    : transcript;

  const narrative = convo
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");

  const budget = await questionBudget();

  hooks.onStatus?.("Checking for related tickets");
  const related = await findRelatedTickets({
    text: narrative,
    studioId: s.data.studioId,
    category: s.data.category,
  }).catch(() => []);

  const toolsEnabled = await momenceAvailable().catch(() => false);
  const toolResults: ToolResult[] = [...(s.toolResults ?? [])];

  // Pre-fetch the studio's timetable BEFORE the first reasoning pass. When a
  // report names a class (or a class-shaped clock time), the model should see
  // the real Momence sessions on its first read — resolving the session, its
  // teacher and its booking count in one model call instead of burning a
  // tool round-trip. Once per session; the post-turn matcher still runs on
  // these rows deterministically.
  // The member record is the other lookup the model must never spend a question
  // on, and it depends on nothing the model says. Resolve it here so the first
  // pass already carries the real spelling, contact and package.
  if (toolsEnabled && !s.memberLookupDone) {
    const memberName = s.data.memberName?.trim();
    if (memberName && !/anonymous|not specified/i.test(memberName)) {
      hooks.onStatus?.("Finding the member in Momence");
      s.memberLookupDone = true;
      toolResults.push(...(await runTools([{ tool: "search_member", args: { query: memberName } }])));
    }
  }

  if (toolsEnabled && !s.autoLookupDone && !s.data.momenceSessionId && s.data.studioId != null) {
    const prefetch = sessionQuery(s, {}, ctx.studios);
    if (prefetch) {
      hooks.onStatus?.("Pulling the class schedule");
      s.autoLookupDone = true;
      toolResults.push(...(await runTools([{ tool: "find_sessions", args: prefetch }])));
    } else if (hasClassSignal(utterance || narrative)) {
      // No specific class named yet — hand over the last two days of the
      // studio's timetable so the model can spot the session itself.
      hooks.onStatus?.("Pulling the studio timetable");
      s.autoLookupDone = true;
      const locationId =
        ctx.studios.find((st) => st.id === s.data.studioId)?.momenceLocationId ?? undefined;
      toolResults.push(
        ...(await runTools([
          { tool: "find_sessions", args: { date: istDate(0), locationId } },
          { tool: "find_sessions", args: { date: istDate(-1), locationId } },
        ])),
      );
    }
  }

  // Recall what the organisation already knows about this studio / member so
  // the agent never re-asks for history that is on file.
  hooks.onStatus?.("Recalling studio history");
  const memoryFacts = await findContextFacts({
    studioId: s.data.studioId,
    memberName: s.data.memberName,
  }).catch(() => []);

  const { known, humanLocked, quotes } = knownForAgent(s);
  // Repetition is the clearest tell of a scripted assistant, and a model cannot
  // avoid repeating what it cannot see. The last two openings go with the turn.
  const recentOpenings = transcript
    .filter((m) => m.role === "assistant" && m.kind !== "draft" && m.content?.trim())
    .slice(-2)
    .map((m) => m.content.split(/\n|\. /)[0] ?? "");
  const agentCtx: AgentContext = {
    reporter: ctx.reporter,
    studios: ctx.studios.map((st) => ({ id: st.id, name: st.name, city: st.city, isHq: st.isHq })),
    known,
    humanLocked,
    quotes,
    recentOpenings,
    asked: s.agentAsked ?? [],
    questionBudget: budget,
    relatedTickets: related.map((r) => ({
      ticketNumber: r.ticketNumber,
      title: r.title,
      createdAt: r.createdAt,
      status: r.status,
    })),
    memoryFacts,
    historicPatterns: issueKnowledgeBlock(narrative, {
      category: s.data.category,
      subcategory: s.data.subcategory,
    }),
    momenceNote: s.data.momenceContext ? JSON.stringify(s.data.momenceContext) : undefined,
    toolsEnabled,
    toolResults,
    summaryCompression: s.contextSummary,
    sessionId: input.sessionId,
  };

  // The summary that keeps a long intake coherent used to be generated only at
  // draft time — after the conversation needed it. Kick it off alongside the
  // model call (it is fast-tier and concurrent, so it costs no wall-clock) and
  // attach it before the turn is persisted.
  const summaryPromise =
    convo.length > 10 && (s.summaryCovered ?? 0) < convo.length - 6
      ? generateSummary(s.contextSummary, convo).catch(() => undefined)
      : null;

  hooks.onStatus?.("Reading your report");
  hooks.onReplyRestart?.();
  const announceLookup = (tool: string) =>
    hooks.onStatus?.(`Checking ${tool.replace(/_/g, " ")} in Momence`);
  let result = await runAgent(convo, agentCtx, {
    onReplyDelta: hooks.onReplyDelta,
    onLookup: announceLookup,
  });

  // Never disguise a rules questionnaire as AI. Preserve the reporter's words
  // and make a transient/configuration failure explicit so the turn can retry.
  if (!result.ok || !result.turn) {
    const failures = (s.agentFailures ?? 0) + 1;
    s.agentFailures = failures;

    // Offering "Retry reasoning" against a deterministic failure produces the
    // same message forever, and the reporter's account is trapped behind it. So
    // a second failure stops asking and does the useful thing instead: build the
    // draft from everything already captured, and say plainly that the last
    // reasoning pass did not complete so the reporter knows to check it.
    if (failures >= 2 && s.data.rawText?.trim()) {
      if (s.data.studioName === undefined) {
        s.data.studioId = null;
        s.data.studioName = "Not studio specific";
      }
      const fallbackInsight = await insightFromAgent({
        text: narrative,
        opening: s.data.reportOpening,
        category: s.data.category ?? "Miscellaneous",
        subcategory: s.data.subcategory ?? "",
        impact: s.data.impact,
        atRisk: s.data.atRisk,
        resolvedNow: s.data.resolvedNow,
        studioName: s.data.studioName,
        memberName: s.data.memberName,
        trainerName: s.data.trainerName,
        classInfo: s.data.classInfo,
      });
      s.step = "review";
      s.insight = fallbackInsight;
      s.pendingQuestionId = null;
      return {
        state: s,
        usedAgent: true,
        userUtterance: utterance,
        degraded: result.error ?? "agent-unavailable",
        model: result.model,
        messages: [
          assistantMessage(
            `My last reasoning pass didn't complete, ${firstName(ctx)}, so I've built the draft from everything you told me rather than making you repeat it. Worth a closer read than usual before you approve.`,
          ),
          reviewMessage(s, ctx, fallbackInsight),
        ],
      };
    }

    s.step = "agent_unavailable";
    return {
      state: s,
      usedAgent: true,
      userUtterance: utterance,
      degraded: result.error ?? "agent-unavailable",
      model: result.model,
      messages: [
        assistantMessage(
          "I’ve kept everything you shared, but I couldn’t complete the reasoning pass. Retry when the AI connection is available — I won’t replace it with a scripted questionnaire.",
          { options: [{ label: "Retry reasoning", value: "retry", tone: "primary" }], allowFreeText: true },
        ),
      ],
    };
  }
  // A pass that completed clears the failure streak.
  s.agentFailures = 0;

  // The model is asked to flag a greeting itself, but it is not the authority on
  // this: a bare "hi" is deterministically not a report, whatever it returned.
  // Only override when nothing substantive has been said yet — a later "hi,
  // there was no electricity…" is a real report that happens to open politely.
  const greetingTurn = Boolean(utterance) && isGreetingOnly(utterance) && !s.data.rawText?.trim();
  if (greetingTurn) result.turn.reportEstablished = false;

  // Keep the durable report narrative free of greeting-only turns, while still
  // retaining every substantive follow-up that may matter to the final draft.
  if (result.turn.reportEstablished !== false && utterance) {
    const existing = s.data.rawText?.trim();
    if (!existing || !existing.endsWith(utterance)) {
      s.data.rawText = [existing, utterance].filter(Boolean).join(" ");
      if (!s.data.reportOpening) s.data.reportOpening = utterance.trim();
    }
  }

  // Conversation is not a ticket yet. Keep the model's invitation and do not
  // classify, consume the question budget, or inject operational gates.
  if (result.turn.reportEstablished === false) {
    s.step = "describe";
    s.pendingQuestionId = null;
    if (summaryPromise) {
      const sum = await summaryPromise;
      if (sum) {
        s.contextSummary = sum;
        s.summaryCovered = convo.length;
      }
    }
    return {
      state: s,
      usedAgent: true,
      userUtterance: utterance,
      model: result.model,
      messages: [assistantMessage(result.turn.reply, { allowFreeText: true, placeholder: "What did the community member share, or what happened?" })],
    };
  }

  applyTurnFacts(result.turn, s, ctx);

  /* ---------------------------------------------------------------- *
   * Deterministic safety net — and no extra reasoning pass.           *
   *                                                                   *
   * These two lookups used to run AFTER the model's pass and each     *
   * triggered a fresh model call, so one message could cost three     *
   * sequential reasoning passes — and each pass wiped the reply the    *
   * reporter was already reading. They are cheap, deterministic and    *
   * independent of the model's judgement, so the member search now     *
   * runs before the first pass (above) and this only ever attaches     *
   * data: ids, the real session label, and the rows for next turn.     *
   * ---------------------------------------------------------------- */
  if (toolsEnabled && result.turn && !s.data.momenceMemberId && !s.memberLookupDone) {
    const memberName = s.data.memberName?.trim();
    if (memberName && !/anonymous|not specified/i.test(memberName)) {
      hooks.onStatus?.("Finding the member in Momence");
      s.memberLookupDone = true;
      toolResults.push(...(await runTools([{ tool: "search_member", args: { query: memberName } }])));
    }
  }

  if (toolsEnabled && result.turn && !s.data.momenceSessionId) {
    // Run our own lookup even if the model already made one: its search is
    // often unscoped or oddly worded, and comes back empty. Ours is filtered by
    // the studio's Momence location and the day the report is about.
    const named = s.autoLookupDone ? null : sessionQuery(s, result.turn.slots, ctx.studios);
    if (named) {
      hooks.onStatus?.("Matching the class in Momence");
      s.autoLookupDone = true;
      toolResults.push(...(await runTools([{ tool: "find_sessions", args: named }])));
    }

    const rows = toolResults
      .filter((r) => r.tool === "find_sessions")
      .flatMap((r) => parseSessionRows(r.result));
    const reported = `${String(result.turn.slots.classInfo?.value ?? s.data.classInfo ?? "")} ${narrative}`;
    const occurredIso = resolveWhenToDate(s.data.occurredAt ?? String(result.turn.slots.occurredAt?.value ?? ""));
    const hit = matchSession(rows, reported, occurredIso);
    if (hit) {
      s.data.momenceSessionId = hit.id;
      s.data.classInfo = hit.label;
      markSlotSource(s, ["momenceSessionId", "classInfo"], "derived");
      s.data.momenceContext = {
        ...(s.data.momenceContext ?? {}),
        sessionId: hit.id,
        sessionName: hit.label,
      };
    }
  }

  s.toolResults = toolResults;

  const turn = result.turn!;
  // A model that keeps asking for lookups past the cap must still move on.
  if (turn.toolCalls?.length) turn.toolCalls = [];

  // A human-set category (button, context bar) is never silently re-classified;
  // a machine judgement must also be a confident one to take the slot.
  const categoryLocked = slotSource(s, "category") === "user" || slotSource(s, "category") === "context";
  if (!s.data.category || (!categoryLocked && turn.classification.confidence >= 0.5)) {
    s.data.category = turn.classification.category;
    s.data.subcategory = turn.classification.subcategory;
    if (!categoryLocked) markSlotSource(s, ["category", "subcategory"], "agent");
  }

  // Corrections are the model's explicit record that the reporter revised an
  // earlier fact — they may override anything, then re-lock to the human side.
  if (turn.extraDetails && Object.keys(turn.extraDetails).length) {
    s.data.extraDetails = { ...(s.data.extraDetails ?? {}), ...turn.extraDetails };
  }
  if (turn.secondaryIssues.length) {
    s.data.secondaryIssues = turn.secondaryIssues.map((i) => ({
      title: i.title,
      category: i.category,
      subcategory: i.subcategory,
      summary: i.summary,
    }));
  }
  s.suggestions = [
    {
      category: turn.classification.category,
      subcategory: turn.classification.subcategory,
      confidence: turn.classification.confidence,
    },
    ...turn.classification.alternates.map((a) => ({ ...a, confidence: 0.4 })),
  ];

  /* ---------------------------------------------------------------- *
   * Question selection — ONE authority, and it is the model.          *
   *                                                                   *
   * The previous design ran nine gates in a row after the model       *
   * landed, each able to replace, invent or delete its question. A    *
   * model that had read the whole conversation and decided the report  *
   * was complete could still be answered with a canned                   *
   * "how many members were affected?". This is that ordering, done     *
   * once, with the model's judgement first and code only as a          *
   * fallback:                                                          *
   *                                                                   *
   *   1. a question about a fact we already hold is dropped — the      *
   *      model may not ask what it already knows (it is told this,     *
   *      and this is the guard)                                        *
   *   2. an owner-critical gap the report genuinely left open is       *
   *      rendered with the best affordance we have (studio buttons, a  *
   *      real Momence session picker) — not replaced with a canned     *
   *      question                                                     *
   *   3. a machine-inferred blast radius is still confirmed once,      *
   *      because it moves severity and the SLA clock                  *
   *   4. a thin fault report that the model considered complete gets   *
   *      ONE question drawn from the curated bank for its category     *
   *   5. nothing else is ever invented. The draft is built.            *
   * ---------------------------------------------------------------- */

  const missing = missingRequired(s.data, s.data.category);
  let question = turn.nextQuestion;
  // Extras belong to the model's own question. If the fallback below asks
  // instead, they are dropped rather than bolted onto a different ask.
  const modelQuestionId = question?.id;
  const followUps = turn.followUps ?? [];
  const knownQuestionSlots: Record<string, unknown> = {
    studio: s.data.studioName,
    raisedFor: s.data.raisedFor,
    member: s.data.memberName,
    memberContact: s.data.memberContact,
    trainer: s.data.trainerName,
    classInfo: s.data.classInfo,
    location: s.data.location,
    systemAffected: s.data.systemAffected,
    membershipRef: s.data.membershipRef,
    occurredAt: s.data.occurredAt,
    impact: s.data.impact,
    atRisk: s.data.atRisk,
    resolvedNow: s.data.resolvedNow,
    frequency: s.data.frequency,
    actionTaken: s.data.actionTaken,
    witnesses: s.data.witnesses,
    amount: s.data.amount,
    notes: s.data.notes,
  };
  const alreadyKnown = (id: string): boolean =>
    id.startsWith("custom:") ? false : knownQuestionSlots[id] !== undefined;

  // Step 1 — a question whose answer is on file, or which the reporter has
  // already been asked, is not a question. The model still gets to decide how
  // the conversation ends; it just cannot interrogate from behind.
  if (question && alreadyKnown(question.id)) question = null;
  if (
    question &&
    /resolv|still (ongoing|happening)|current status/i.test(`${question.id} ${question.ask}`) &&
    s.data.resolvedNow !== undefined
  ) {
    question = null;
  }
  const askedBefore = new Set(s.agentAsked ?? []);
  const repeated = Boolean(question && askedBefore.has(question.id));

  // Whether Momence can be asked "which classes, and who was in them" — that
  // decides whether the blast radius is a question for the reporter at all.
  const classSignal = hasClassSignal(narrative);
  const operationalFault =
    !s.data.plannedWork &&
    ["Repair and Maintenance", "Tech Issues", "Operating Systems", "Safety and Security", "Class Experience"]
      .includes(s.data.category ?? "");

  const questionBudgetLeft = (s.agentAsked?.length ?? 0) < budget;
  const asked = (id: string): boolean => !(s.agentAsked ?? []).includes(id);

  const IMPACT_CHOICES = [
    "Safety risk / classes blocked",
    "Several members affected",
    "One member / minor disruption",
    "Suggestion or idea",
  ].map((label) => ({ label, value: `ans:impact|${label}` }));
  const RESOLVED_CHOICES = [
    { label: "Resolved / fixed now", value: "ans:resolvedNow|Yes — resolved" },
    { label: "Still happening", value: "ans:resolvedNow|No — still happening" },
  ];

  /* Step 2 — the affordance pass. The model's own question keeps its wording;
     code only upgrades how it can be answered, which is the difference between
     typing a class name and tapping the real session off the timetable. */
  if (question) {
    const subject = `${question.id} ${question.ask}`;
    const canPickSessions = toolsEnabled && classSignal;
    if (/studio|which site|which location/i.test(subject) && missing.includes("studio")) {
      question = { ...question, id: "studio", allowFreeText: false };
    } else if (canPickSessions && /which class|what class|which session|which classes/i.test(subject)) {
      question = { ...question, id: "sessions", picker: "sessions", allowFreeText: true };
    } else if (
      s.data.momenceSessionIds?.length &&
      /who was|which members|how many members|who else/i.test(subject)
    ) {
      question = { ...question, id: "attendees", picker: "attendees", allowFreeText: true };
    } else if (question.id === "impact" && !question.options?.length) {
      question = { ...question, options: IMPACT_CHOICES };
    } else if (question.id === "resolvedNow" && !question.options?.length) {
      question = { ...question, options: RESOLVED_CHOICES };
    }
  }

  /* Step 3 — owner-critical gate. Only ever fires when the model asked nothing
     at all, so it can add a missing question but never overrule one. */
  const GATE_ASK: Record<string, string> = {
    studio: "Which studio does this relate to?",
    impact: "How wide is the impact — safety risk, several members, one member, or a suggestion?",
    resolvedNow: "Is this resolved now, or still happening?",
  };
  if (!question && !repeated) {
    const relevantGates = [
      "studio",
      ...(operationalFault ? ["resolvedNow"] : []),
      ...(toolsEnabled && classSignal ? [] : ["impact"]),
    ] as readonly string[];
    for (const gate of relevantGates) {
      if (!missing.includes(gate) || !asked(gate)) continue;
      question = {
        id: gate,
        ask: GATE_ASK[gate],
        allowFreeText: gate !== "studio",
        ...(gate === "impact"
          ? { options: IMPACT_CHOICES }
          : gate === "resolvedNow"
            ? { options: RESOLVED_CHOICES }
            : {}),
      };
      break;
    }
  }

  // Scheduled work has its own owner-critical gap, and it is not "is it fixed":
  // it is when, and whether the classes in that window have been dealt with.
  if (!question && s.data.plannedWork && !s.data.plannedWindow && asked("custom:planned_window")) {
    question = {
      id: "custom:planned_window",
      ask: "What are the exact dates — when does it start, and how long is it out for?",
      why: "the owner needs the window to move classes and tell members before it starts",
      allowFreeText: true,
      placeholder: "e.g. 14 Sept for 10 days",
    };
  }

  /* Step 4 — the session and attendee pickers. A regex reading of "BBB at 10,
     cycle at 10.30, FIT at 11" produces a string nobody can act on and no
     session ids; the timetable produces both. Only the reporter can say which
     of those rows the problem hit, so this is a pick, not a lookup. */
  const sessionsUnconfirmed = s.data.momenceSessionIds === undefined;
  if (!question && toolsEnabled && classSignal && sessionsUnconfirmed && asked("sessions")) {
    question = {
      id: "sessions",
      ask: "Which classes did this hit? Tick every one from the timetable.",
      why: "picking the real sessions attaches their rosters and bookings to the ticket",
      picker: "sessions",
      allowFreeText: true,
      skipLabel: "Not class specific",
    };
  } else if (
    !question &&
    toolsEnabled &&
    s.data.momenceSessionIds?.length &&
    s.data.affectedMembers === undefined &&
    asked("attendees")
  ) {
    question = {
      id: "attendees",
      ask: "Who was actually in those classes? Tick anyone affected.",
      why: "these are the people the owner may need to credit or call",
      picker: "attendees",
      allowFreeText: true,
      skipLabel: "Nobody specific",
    };
  }

  /* Step 5 — an inferred blast radius is a guess, and it moves severity, the
     SLA clock and who gets paged. Confirmed once, and only for a live fault:
     "how wide is the impact" asked about a compliment is the question that
     made the assistant feel like a form. */
  if (
    !question &&
    operationalFault &&
    !s.data.plannedWork &&
    (s.data.impact === "many" || s.data.impact === "safety") &&
    slotSource(s, "impact") === "agent" &&
    asked("impact")
  ) {
    question = {
      id: "impact",
      ask: `I've read this as ${IMPACT_LABEL[s.data.impact] ?? s.data.impact} — how many members were actually affected?`,
      why: "it sets the severity and the SLA clock, so I'd rather have your number than my guess",
      allowFreeText: true,
      placeholder: "e.g. 1 client in cycle, 6 in FIT",
      options: [
        { label: "Safety risk / classes blocked", value: "ans:impact|Safety risk / classes blocked" },
        { label: "Several members affected", value: "ans:impact|Several members affected" },
        { label: "One member / minor disruption", value: "ans:impact|One member / minor disruption" },
      ],
    };
  }

  /* Step 6 — the thin-report fallback, and it is now a real question.
     "The mic in Studio 2 doesn't work" satisfies every slot gate and still
     tells the owner nothing they can act on. The old ladder asked a device
     symptom ("is it dead, cutting out, distorted?") of any thin report in six
     categories — including a theft — because the ladder never read the report.
     The curated bank is category-shaped instead, and a report that already
     carries the detail is left alone. */
  const detailCarried = [
    s.data.actionTaken, s.data.occurredAt, s.data.frequency,
    s.data.witnesses, s.data.classInfo, s.data.notes, s.data.affectedMembers,
  ].filter((v) => v !== undefined && v !== "").length;
  const thinReport = narrative.trim().length < 220 && detailCarried < 2;
  if (!question && thinReport && questionBudgetLeft && operationalFault) {
    const fallback = thinReportQuestion(s);
    if (fallback) question = fallback;
  }

  // Never ask the same thing twice. If the answer did not land the first time,
  // asking again just loops the reporter — take what we have and draft.
  if (question && askedBefore.has(question.id)) question = null;

  // Reporters can explicitly stop clarification. We retain unknown fields as
  // unknown and build the best reviewable draft from the evidence provided.
  const wantsDraftNow =
    /just (raise|file|log|create)( the)? (it|ticket|draft)\b|raise (it|the ticket) (now|directly)|skip (the )?questions|no more questions|(?:show|make|create|prepare) (?:me )?(?:the )?draft|draft it now/i.test(
      utterance,
    );
  if (wantsDraftNow) question = null;

  const first = (state.agentAsked?.length ?? 0) === 0 && state.step === "describe";

  if (question) {
    // Extras belong to the model's own question. A gate that replaced it is a
    // different ask, and bolting unrelated extras onto it reads as a non
    // sequitur.
    const extras =
      question.id === modelQuestionId
        ? followUps.filter(
            (f) =>
              f.id !== question!.id &&
              knownQuestionSlots[f.id] === undefined &&
              !(s.agentAsked ?? []).includes(f.id),
          )
        : [];
    s.step = "agent_q";
    s.pendingQuestionId = question.id;
    // Each extra is logged under the slot it fills, exactly like the primary
    // question. That is what makes it chaseable: at draft time the controller
    // can see the slot is still empty and carry the ask onto the ticket
    // instead of letting the reporter's unanswered question evaporate.
    s.agentAsked = [...(s.agentAsked ?? []), question.id, ...extras.map((f) => f.id)];
    s.agentAskLog = [
      ...(s.agentAskLog ?? []),
      { id: question.id, ask: question.ask },
      ...extras.map((f) => ({ id: f.id, ask: f.ask })),
    ];
    const messages = [questionMessage(question, s, ctx, budget, turn.reply, extras)];
    if (summaryPromise) {
      const sum = await summaryPromise;
      if (sum) {
        s.contextSummary = sum;
        s.summaryCovered = convo.length;
      }
    }
    return { state: s, messages, usedAgent: true, userUtterance: utterance, model: result.model };
  }

  // Ready for the draft. If the studio was never established, say so on the
  // ticket rather than leaving the field blank.
  if (s.data.studioName === undefined) {
    s.data.studioId = null;
    s.data.studioName = "Not studio specific";
  }

  // A gate that was asked and skipped must not block the draft — record the
  // honest default instead ("minor/single impact", "not yet resolved").
  // Unknown stays unknown. The draft may state that follow-up is required, but
  // must never turn a skipped or unclear reply into a confirmed fact.

  // Asking a question and then filing the ticket as though it never happened is
  // how the reporter's answer gets lost. Anything asked whose slot is still
  // empty — plus a question still pending as we draft — goes onto the ticket as
  // an open item, so the owner knows to chase it rather than assuming it's
  // covered.
  // A custom question has no slot to check, so the only evidence is whether the
  // reporter engaged with it: a skip, a "don't know", or "just raise it" leaves
  // it open, while any substantive reply is taken as the answer.
  const declined =
    !utterance ||
    wantsDraftNow ||
    /^(skip|pass|don'?t know|dunno|no idea|not sure|unknown|n\/a|not applicable)[.!]?$/i.test(
      utterance.trim(),
    );
  const unanswered = (s.agentAskLog ?? [])
    .filter((entry) =>
      entry.id.startsWith("custom:")
        ? declined && s.pendingQuestionId === entry.id
        : knownQuestionSlots[entry.id] === undefined,
    )
    .map((entry) => entry.ask.trim())
    .filter(Boolean);
  if (unanswered.length) {
    s.data.extraDetails = {
      ...(s.data.extraDetails ?? {}),
      "Still to confirm": [...new Set(unanswered)].join(" · "),
    };
  }

  hooks.onStatus?.("Building the draft");
  const insight = await insightFromAgent({
    agent: turn.insight,
    text: narrative,
    opening: s.data.reportOpening,
    category: s.data.category ?? "Miscellaneous",
    subcategory: s.data.subcategory ?? "",
    impact: s.data.impact,
    atRisk: s.data.atRisk,
    resolvedNow: s.data.resolvedNow,
    studioName: s.data.studioName,
    memberName: s.data.memberName,
    trainerName: s.data.trainerName,
    classInfo: s.data.classInfo,
    model: result.model,
    confidence: turn.classification.confidence,
  });

  s.step = "review";
  s.insight = insight;
  s.pendingQuestionId = null;

  // Park a compressed form of the conversation on the session: if the reporter
  // edits and returns, later model calls keep the whole narrative in a few
  // sentences instead of losing it to the transcript window.
  if (convo.length > 6 || turn.summaryCompression) {
    // A summary is worth keeping on the session — the reporter may edit and
    // come back. The model's own compression wins when it wrote one, otherwise
    // the pass already running (or a fresh one) covers it.
    const summary = turn.summaryCompression
      ? turn.summaryCompression
      : ((await (summaryPromise ?? generateSummary(s.contextSummary, convo).catch(() => undefined))) ??
        s.contextSummary);
    if (summary) {
      s.contextSummary = summary;
      s.summaryCovered = convo.length;
    }
  }

  const messages: ChatMessage[] = [];
  // A reply that still asks for something cannot lead a finished draft. The
  // controller has decided this turn ends in the draft, so "I need to know
  // where it's happening" followed immediately by the completed ticket reads
  // as an assistant arguing with itself.
  const replyAsks = /\?|\bi (?:still )?need to know\b|\bcould you (?:tell|share|confirm)\b|\blet me know\b/i.test(
    turn.reply ?? "",
  );
  if (turn.reply && !replyAsks) {
    messages.push(
      assistantMessage(turn.reply, {
        ...(first ? { analysis: analysisChips(s, turn.classification.confidence) } : {}),
        ...(inferred.length ? { inferred } : {}),
      }),
    );
  }
  messages.push(reviewMessage(s, ctx, insight, turn.handoverNote));
  return { state: s, messages, usedAgent: true, userUtterance: utterance, model: result.model };
}

export { buildDraft };
