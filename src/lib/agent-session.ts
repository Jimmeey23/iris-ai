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
import { CATEGORY_META } from "./taxonomy";
import { applyComposerContext, inferFromText, IMPACT_LABEL } from "./chat-inference";
import { runAgent, generateSummary, questionOptions, CANONICAL_SLOTS, type AgentContext, type AgentQuestion } from "./agent";
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
const DETERMINISTIC_STEPS = new Set(["review", "edit_menu", "created"]);
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

const CANONICAL_SLOT_IDS = new Set<string>(CANONICAL_SLOTS);

/**
 * Option answers, in two shapes: `ans:<slotId>|<label>` names the slot
 * explicitly (gates), and plain `ans:<label>` binds to the question currently
 * pending when that question is a canonical slot. Pure so the contract tests
 * can exercise it; `applyOptionAnswer` is the stateful wrapper.
 */
function resolveOptionAnswer(
  value: string,
  pendingQuestionId?: string | null,
): { slot?: string; label: string } {
  if (!value.startsWith("ans:")) return { label: "" };
  const rest = value.slice(4);
  const sep = rest.indexOf("|");
  let id: string;
  let label: string;
  if (sep !== -1) {
    id = rest.slice(0, sep);
    label = rest.slice(sep + 1);
  } else {
    label = rest;
    const pending = pendingQuestionId ?? null;
    if (!pending || !CANONICAL_SLOT_IDS.has(pending)) return { label };
    id = pending;
  }
  if (!id || !label) return { label };
  return { slot: id === "resolved" ? "resolvedNow" : id, label };
}

function absorbExplicitAnswer(
  value: string,
  s: IntakeState,
): { slot: string; label: string } | null {
  const result = resolveOptionAnswer(value, s.pendingQuestionId ?? null);
  if (!result.slot) return null;
  applyAnswerToSlot(result.slot, result.label, s);
  markSlotSource(s, result.slot, "user");
  return { slot: result.slot, label: result.label };
}

/** Deterministic mapping from a canonical slot id to a tapped option label. */
function applyAnswerToSlot(slot: string, label: string, s: IntakeState): void {
  const d = s.data;
  const v = label.trim();
  if (!v) return;
  switch (slot) {
    case "raisedFor": d.raisedFor = normaliseRaisedFor(v); break;
    case "impact": {
      // Option labels are English sentences; the stored value is the stable key.
      const key = ["safety", "many", "single", "suggestion"].find((k) =>
        k === "many"
          ? /several|many|multiple/i.test(v)
          : k === "single"
            ? /one member|minor|single/i.test(v)
            : v.toLowerCase().includes(k),
      );
      // A skip-style label ("Not applicable") must not invent a wrong impact.
      if (key) d.impact = key;
      break;
    }
    case "resolvedNow": {
      // Anchored, prefix-tolerant: gate labels are sentences like
      // "Yes — resolved" / "No — still happening".
      const t = v.trim().toLowerCase();
      d.resolvedNow = /^(true|yes|resolved|fixed|fine)/.test(t)
        ? true
        : /^(false|no|not|still|unresolved|happening)/.test(t)
          ? false
          : d.resolvedNow;
      break;
    }
    case "atRisk": d.atRisk = /^(yes|true)/i.test(v); break;
    case "frequency": d.frequency = v; break;
    case "occurredAt": d.occurredAt = v; break;
    case "location": d.location = v; break;
    case "systemAffected": d.systemAffected = v; break;
    case "classInfo": d.classInfo = v; break;
    case "membershipRef": d.membershipRef = v; break;
    case "trainer": d.trainerName = v; break;
    case "member": d.memberName = v; break;
    case "memberContact": d.memberContact = v; break;
    case "actionTaken": d.actionTaken = v; break;
    case "witnesses": d.witnesses = v; break;
    case "amount": d.amount = v; break;
    case "notes": d.notes = v; break;
    default: break; // custom:* and unknown ids ride along as words only
  }
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
): { slot?: string; label: string } {
  const result = resolveOptionAnswer(value, pendingQuestionId);
  if (result.slot) {
    applyAnswerToSlot(result.slot, result.label, s);
    markSlotSource(s, result.slot, "user");
  }
  return result;
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

  const explicit = absorbExplicitAnswer(value, s);
  if (explicit) {
    return { utterance: explicit.label, inferred };
  }

  if (value.startsWith("ans:")) return { utterance: value.slice(4), inferred };

  if (value === "resolvedNow:yes" || value === "resolvedNow:no") {
    d.resolvedNow = value === "resolvedNow:yes";
    markSlotSource(s, "resolvedNow", "user");
    return {
      utterance: d.resolvedNow ? "It is resolved / fixed now." : "It is still happening — not resolved.",
      inferred,
    };
  }

  if (value.startsWith("studio:")) {
    const rest = value.slice(7);
    markSlotSource(s, "studio", "user");
    if (rest === "none") {
      d.studioId = null;
      d.studioName = "Not studio specific";
      return { utterance: "Not studio specific.", inferred };
    }
    const studio = ctx.studios.find((st) => st.id === Number(rest));
    if (studio) {
      d.studioId = studio.id;
      d.studioName = `${studio.name}, ${studio.city}`;
      return { utterance: `The studio is ${d.studioName}.`, inferred };
    }
  }

  if (value.startsWith("member:")) {
    const [, id, ...rest] = value.split(":");
    const numeric = Number(id);
    if (Number.isFinite(numeric) && rest.length > 0) {
      d.momenceMemberId = numeric;
      d.memberName = rest.join(":");
    } else {
      d.memberName = value.slice(7);
    }
    markSlotSource(s, ["member", "momenceMemberId"], "user");
    return { utterance: `The member is ${d.memberName}.`, inferred };
  }

  if (value.startsWith("session:")) {
    const [, id, ...rest] = value.split(":");
    d.momenceSessionId = Number(id);
    const [name, at, teacher] = rest.join(":").split("|");
    d.classInfo = name;
    if (at) d.classAt = at;
    if (teacher && !d.trainerName) d.trainerName = teacher;
    markSlotSource(s, ["momenceSessionId", "classInfo"], "user");
    return {
      utterance: `The class was ${[name, at, teacher && `taught by ${teacher}`].filter(Boolean).join(", ")}.`,
      inferred,
    };
  }

  if (value.startsWith("trainer:")) {
    d.trainerName = value.slice(8);
    markSlotSource(s, "trainerName", "user");
    return { utterance: `The trainer was ${d.trainerName}.`, inferred };
  }

  if (value.startsWith("membership:") || value.startsWith("mem:")) {
    d.membershipRef = value.replace(/^(membership|mem):/, "");
    markSlotSource(s, "membershipRef", "user");
    return { utterance: `Membership: ${d.membershipRef}.`, inferred };
  }

  if (value === "skip") return { utterance: "Skip that one.", inferred };
  if (value === "browse") return { utterance: "Let me pick the category myself.", inferred };
  if (value.startsWith("cat:")) {
    d.category = value.slice(4);
    d.subcategory = undefined;
    markSlotSource(s, "category", "user");
    return { utterance: `File this under ${d.category}.`, inferred };
  }
  if (value.startsWith("sub:")) {
    d.subcategory = value.slice(4);
    markSlotSource(s, "subcategory", "user");
    return { utterance: `The subcategory is ${d.subcategory}.`, inferred };
  }

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

function bindPendingTextAnswer(text: string, s: IntakeState): void {
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
    applyAnswerToSlot(pending, answer, s);
    if (s.data.impact === undefined) return;
  } else if (pending === "atRisk") {
    if (!/^(yes|no|true|false)\b/i.test(answer)) return;
    s.data.atRisk = /^(yes|true)\b/i.test(answer);
  } else if (TEXT_ANSWER_SLOTS.has(pending)) {
    applyAnswerToSlot(pending, answer, s);
  } else {
    return;
  }
  markSlotSource(s, pending === "trainer" ? "trainerName" : pending, "user");
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
    if (norm(studio.code) === said) score = Math.max(score, 90);

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
  return { known, humanLocked };
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

function questionMessage(
  q: AgentQuestion,
  reply: string,
  s: IntakeState,
  ctx: EngineContext,
  inferred: string[],
  budget: number,
): ChatMessage {
  const body = q.why ? `${q.ask}\n_${q.why}_` : q.ask;
  // The structured question owns the ask (and may have been replaced by a
  // routing gate). Keep acknowledgement sentences, never a second model ask.
  const acknowledgement = reply
    .split(/(?<=[.!?])\s+|\n+/u)
    .filter((sentence) => !sentence.includes("?"))
    .join(" ")
    .trim();
  const content = acknowledgement ? `${acknowledgement}\n\n${body}` : body;
  const options = q.id === "studio" ? studioOptions(ctx) : questionOptions(q);
  return assistantMessage(content, {
    options,
    allowFreeText: q.allowFreeText ?? true,
    placeholder: q.placeholder,
    picker: q.picker,
    remaining: Math.max(0, budget - (s.agentAsked?.length ?? 0)),
    ...(inferred.length ? { inferred } : {}),
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
};

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
    bindPendingTextAnswer(utterance, s);
    const before = { ...s.data };
    inferred.push(...inferFromText(utterance, s, ctx));
    for (const [key, value] of Object.entries(s.data)) {
      if (value !== undefined && value !== before[key as keyof typeof before]) {
        markSlotSource(s, key === "trainerName" ? "trainerName" : key, "user");
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

  const { known, humanLocked } = knownForAgent(s);
  const agentCtx: AgentContext = {
    reporter: ctx.reporter,
    studios: ctx.studios.map((st) => ({ id: st.id, name: st.name, city: st.city, isHq: st.isHq })),
    known,
    humanLocked,
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

  hooks.onStatus?.("Reading your report");
  hooks.onReplyRestart?.();
  let result = await runAgent(convo, agentCtx, { onReplyDelta: hooks.onReplyDelta });

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
    }
  }

  // Conversation is not a ticket yet. Keep the model's invitation and do not
  // classify, consume the question budget, or inject operational gates.
  if (result.turn.reportEstablished === false) {
    s.step = "describe";
    s.pendingQuestionId = null;
    return {
      state: s,
      usedAgent: true,
      userUtterance: utterance,
      model: result.model,
      messages: [assistantMessage(result.turn.reply, { allowFreeText: true, placeholder: "What did the community member share, or what happened?" })],
    };
  }

  applyTurnFacts(result.turn, s, ctx);

  // Momence lookup loop. The agent asks for facts, we fetch them, it continues.
  // Capped so a confused model cannot spin, and every result is remembered on
  // the session so the same lookup is never paid for twice.
  const TOOL_ROUNDS = 2;
  for (let round = 0; round < TOOL_ROUNDS; round++) {
    const calls = result.turn?.toolCalls ?? [];
    if (!calls.length) break;
    hooks.onStatus?.(`Looking up ${calls.map((c) => c.tool.replace(/_/g, " ")).join(", ")} in Momence`);
    const fresh = await runTools(calls);
    toolResults.push(...fresh);
    hooks.onReplyRestart?.();
    const next = await runAgent(
      convo,
      { ...agentCtx, known: knownForAgent(s).known, toolResults },
      { onReplyDelta: hooks.onReplyDelta },
    );
    if (!next.ok || !next.turn) break;
    result = next;
    applyTurnFacts(next.turn, s, ctx);
  }

  // The model must never burn a question on facts Momence holds. When a member
  // is named but has no id yet, resolve them once — the roster record carries
  // the real spelling, contact and membership that the ticket should carry.
  if (toolsEnabled && result.turn && !s.data.momenceMemberId && !s.memberLookupDone) {
    const memberName = s.data.memberName?.trim();
    if (memberName && !/anonymous|not specified/i.test(memberName)) {
      hooks.onStatus?.("Finding the member in Momence");
      s.memberLookupDone = true;
      toolResults.push(...(await runTools([{ tool: "search_member", args: { query: memberName } }])));
      hooks.onReplyRestart?.();
      const next = await runAgent(
        convo,
        { ...agentCtx, known: knownForAgent(s).known, toolResults },
        { onReplyDelta: hooks.onReplyDelta },
      );
      if (next.ok && next.turn) result = next;
      if (next.ok && next.turn) applyTurnFacts(next.turn, s, ctx);
    }
  }

  // Resolving a named class to a real Momence session is the point of the
  // integration, and the model does it only sometimes. So: make sure the lookup
  // happens, then pick the row in code whenever the answer is unambiguous.
  if (toolsEnabled && result.turn && !s.data.momenceSessionId) {
    // Run our own lookup even if the model already made one: its search is
    // often unscoped or oddly worded, and comes back empty. Ours is filtered by
    // the studio's Momence location and the day the report is about. Once per
    // session, so a conversation cannot accumulate lookups.
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

    // Only worth another model call when we fetched something it has not seen.
    if (named) {
      hooks.onReplyRestart?.();
      const next = await runAgent(
        convo,
        { ...agentCtx, known: knownForAgent(s).known, toolResults },
        { onReplyDelta: hooks.onReplyDelta },
      );
      if (next.ok && next.turn) result = next;
      if (next.ok && next.turn) applyTurnFacts(next.turn, s, ctx);
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

  const missing = missingRequired(s.data);
  let question = turn.nextQuestion;
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

  // The controller is the final guard against asking for an established fact.
  if (question && !question.id.startsWith("custom:") && knownQuestionSlots[question.id] !== undefined) {
    question = null;
  }
  if (question && /resolv|still (ongoing|happening)|current status/i.test(`${question.id} ${question.ask}`) && s.data.resolvedNow !== undefined) {
    question = null;
  }

  // A question about the studio is the studio question, whatever the model
  // decided to call it — that keeps the picker and the dedupe below honest.
  if (question && /studio|location of the studio|which studio/i.test(question.id + " " + question.ask)) {
    if (missing.includes("studio")) question = { ...question, id: "studio", allowFreeText: false };
  }

  // Owner-critical gates. Routing, live-vs-resolved and blast radius change
  // what the owner physically does, so they outrank the question budget: one
  // focused question each, never the same one twice, with concrete options.
  const GATE_ASK: Record<string, string> = {
    studio: "Which studio does this relate to?",
    impact: "How wide is the impact — safety risk, several members, one member, or a suggestion?",
    resolvedNow: "Is this resolved now, or still happening?",
  };
  if (missing.includes("studio") && !(s.agentAsked ?? []).includes("studio")) {
    // Studio drives routing — it overrides whatever the model asked this turn.
    question = { id: "studio", ask: GATE_ASK.studio, allowFreeText: false };
  } else if (!question) {
    const operationalFault = [
      "Repair and Maintenance", "Tech Issues", "Operating Systems",
      "Safety and Security", "Class Experience",
    ].includes(s.data.category ?? "");
    const relevantGates = operationalFault ? (["resolvedNow", "impact"] as const) : (["impact"] as const);
    for (const gate of relevantGates) {
      if (!missing.includes(gate) || (s.agentAsked ?? []).includes(gate)) continue;
      question = {
        id: gate,
        ask: GATE_ASK[gate],
        allowFreeText: true,
        ...(gate === "impact"
          ? { options: ["Safety risk / classes blocked", "Several members affected", "One member / minor disruption", "Suggestion or idea"].map((label) => ({ label, value: `ans:impact|${label}` })) }
          : {
              options: [
                { label: "Resolved / fixed now", value: "ans:resolved|Yes — resolved" },
                { label: "Still happening", value: "ans:resolved|No — still happening" },
              ],
            }),
      };
      break;
    }
  }

  // An INFERRED blast radius is a guess, and it moves severity, the SLA clock
  // and who gets paged. The gates above only fire when a slot is missing, so a
  // model that confidently wrote impact="many" from a report about one attendee
  // silently satisfies the gate that exists to catch exactly that. When the
  // guess is one of the two that escalate, confirm it once.
  if (
    !question &&
    (s.data.impact === "many" || s.data.impact === "safety") &&
    slotSource(s, "impact") === "agent" &&
    !(s.agentAsked ?? []).includes("impact")
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

  // Never ask the same thing twice. If the answer did not land the first time,
  // asking again just loops the reporter — take what we have and draft.
  if (question && (s.agentAsked ?? []).includes(question.id)) {
    question = null;
  }

  // Reporters can explicitly stop clarification. We retain unknown fields as
  // unknown and build the best reviewable draft from the evidence provided.
  const wantsDraftNow =
    /just (raise|file|log|create)( the)? (it|ticket|draft)\b|raise (it|the ticket) (now|directly)|skip (the )?questions|no more questions|(?:show|make|create|prepare) (?:me )?(?:the )?draft|draft it now/i.test(
      utterance,
    );
  if (wantsDraftNow) question = null;

  const first = (state.agentAsked?.length ?? 0) === 0 && state.step === "describe";

  if (question) {
    s.step = "agent_q";
    s.pendingQuestionId = question.id;
    s.agentAsked = [...(s.agentAsked ?? []), question.id];
    s.agentAskLog = [...(s.agentAskLog ?? []), { id: question.id, ask: question.ask }];
    const message = questionMessage(question, turn.reply, s, ctx, inferred, budget);
    if (first) message.analysis = analysisChips(s, turn.classification.confidence);
    const messages = [message];
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
    const summary = await generateSummary(turn.summaryCompression ?? s.contextSummary, convo).catch(
      () => s.contextSummary,
    );
    if (summary) {
      s.contextSummary = summary;
      s.summaryCovered = convo.length;
    }
  }

  const messages: ChatMessage[] = [];
  if (turn.reply) {
    messages.push(
      assistantMessage(turn.reply, {
        ...(first ? { analysis: analysisChips(s, turn.classification.confidence) } : {}),
        ...(inferred.length ? { inferred } : {}),
      }),
    );
  }
  messages.push(reviewMessage(s, ctx, insight));
  return { state: s, messages, usedAgent: true, userUtterance: utterance, model: result.model };
}

export { buildDraft };
