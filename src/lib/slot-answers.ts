/**
 * One registry for turning a click into a slot value.
 *
 * Before this module there were two vocabularies: the agent path understood
 * `ans:` / `studio:` / `session:` (and silently dropped everything else), while
 * the deterministic questionnaire rendered `for:`, `class:`, `loc:`, `sys:`,
 * `when:`, `impact:`, `risk:` and `freq:`. A click on one of those reached the
 * agent path, produced an empty utterance and became a silent no-op — after the
 * edit flow had already cleared the field it was editing.
 *
 * So there is now exactly one place that knows how an option value maps to a
 * slot, and both engines call it:
 *
 *  - `parseOptionValue` — value (plus the question that was pending) → slot + label
 *  - `applySlotAnswer`  — slot + label → the intake field
 *
 * `CANONICAL_SLOTS` also lives here so the agent contract, the option parser and
 * the tests can never drift apart again.
 *
 * It imports only `guardrails` (for the raised-for enum mapping), which sits
 * above it — `chat-engine` and `chat-inference` both depend on this module, so
 * nothing here may import them back.
 */
import { normaliseRaisedFor } from "./guardrails";

/** Canonical slots the draft understands. The model may also invent custom ones. */
export const CANONICAL_SLOTS = [
  "studio", "raisedFor", "member", "memberContact", "trainer", "classInfo",
  "location", "systemAffected", "membershipRef", "occurredAt", "impact",
  "atRisk", "resolvedNow", "plannedWork", "frequency", "actionTaken", "witnesses", "amount", "notes",
  "momenceSessionId", "momenceMemberId",
] as const;
export type CanonicalSlot = (typeof CANONICAL_SLOTS)[number];

export const CANONICAL_SLOT_IDS: ReadonlySet<string> = new Set(CANONICAL_SLOTS);

/** The intake fields this module can write. Structural, so no import cycle. */
export type SlotAnswerData = {
  raisedFor?: string;
  impact?: string;
  resolvedNow?: boolean;
  atRisk?: boolean;
  plannedWork?: boolean;
  frequency?: string;
  occurredAt?: string;
  location?: string;
  systemAffected?: string;
  classInfo?: string;
  membershipRef?: string;
  trainerName?: string;
  memberName?: string;
  memberContact?: string;
  actionTaken?: string;
  witnesses?: string;
  amount?: string;
  notes?: string;
  extraDetails?: Record<string, string>;
};

const IMPACT_KEYS = ["safety", "many", "single", "suggestion"] as const;

/**
 * Option labels are sentences ("Several members affected"); the stored value is
 * the stable key. Matching is deliberately generous because the model writes the
 * labels it renders.
 */
export function impactKeyFromLabel(label: string): string | undefined {
  const v = label.trim().toLowerCase();
  if (!v) return undefined;
  if (/\bsafety\b|\bblocked\b|\bunsafe\b|\bhazard\b/.test(v)) return "safety";
  if (/\bseveral\b|\bmany\b|\bmultiple\b|\bgroup\b/.test(v)) return "many";
  if (/\bone member\b|\bsingle\b|\bminor\b|\bindividual\b/.test(v)) return "single";
  if (/\bsuggest|\bidea\b|\bimprovement\b|\bfeedback\b/.test(v)) return "suggestion";
  const direct = IMPACT_KEYS.find((k) => v === k || v.includes(k));
  return direct;
}

/** "Yes — resolved" / "No — still happening" / a plain yes/no. */
export function resolvedFromLabel(label: string): boolean | undefined {
  const t = label.trim().toLowerCase();
  if (/^(true|yes|y|resolved|fixed|restored|back|fine|sorted)\b/.test(t)) return true;
  if (/^(false|no|n|not|still|unresolved|ongoing|happening|pending)\b/.test(t)) return false;
  return undefined;
}

/**
 * Apply a canonical slot answer to intake data.
 *
 * Every branch is total: an unparsable label leaves the field untouched rather
 * than storing prose in a boolean, and a `custom:` id rides along as an extra
 * detail. Callers mark provenance — this function only writes values.
 */
export function applySlotAnswer(slot: string, label: string, d: SlotAnswerData): boolean {
  const v = label.trim();
  if (!v) return false;
  switch (slot) {
    case "raisedFor":
      d.raisedFor = normaliseRaisedFor(v);
      return true;
    case "impact": {
      const key = impactKeyFromLabel(v);
      if (!key) return false;
      d.impact = key;
      return true;
    }
    case "resolvedNow": {
      const resolved = resolvedFromLabel(v);
      if (resolved === undefined) return false;
      d.resolvedNow = resolved;
      return true;
    }
    case "atRisk": {
      const yes = /^(yes|true|y)\b/i.test(v);
      const no = /^(no|false|n)\b/i.test(v);
      if (!yes && !no) return false;
      d.atRisk = yes;
      return true;
    }
    case "plannedWork": {
      const yes = /^(yes|true|y)\b/i.test(v);
      const no = /^(no|false|n)\b/i.test(v);
      if (!yes && !no) return false;
      d.plannedWork = yes;
      return true;
    }
    case "frequency": d.frequency = v; return true;
    case "occurredAt": d.occurredAt = v; return true;
    case "location": d.location = v; return true;
    case "systemAffected": d.systemAffected = v; return true;
    case "classInfo": d.classInfo = v; return true;
    case "membershipRef": d.membershipRef = v; return true;
    case "trainer": d.trainerName = v; return true;
    case "member": d.memberName = v; return true;
    case "memberContact": d.memberContact = v; return true;
    case "actionTaken": d.actionTaken = v; return true;
    case "witnesses": d.witnesses = v; return true;
    case "amount": d.amount = v; return true;
    case "notes": d.notes = v; return true;
    default: {
      if (slot.startsWith("custom:")) {
        const key = slot.slice(7).replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
        d.extraDetails = { ...(d.extraDetails ?? {}), [key]: v };
        return true;
      }
      return false;
    }
  }
}

export type ParsedOption = { slot?: string; label: string };

/** `resolved` is the legacy gate id for what the state calls `resolvedNow`. */
const SLOT_ALIASES: Record<string, string> = { resolved: "resolvedNow" };

/**
 * `ans:<slotId>|<label>` names its slot explicitly (this is what every renderer
 * now emits). A bare `ans:<label>` binds to the question that was pending, but
 * only when that question is a canonical slot — a `custom:` question has no
 * field to write, so the words ride along in the transcript instead.
 */
function parseAnsValue(value: string, pendingQuestionId?: string | null): ParsedOption {
  const rest = value.slice(4);
  const sep = rest.indexOf("|");
  let id: string | undefined;
  let label: string;
  if (sep !== -1) {
    id = rest.slice(0, sep).trim();
    label = rest.slice(sep + 1);
  } else {
    label = rest;
    const pending = pendingQuestionId ?? null;
    if (pending && CANONICAL_SLOT_IDS.has(SLOT_ALIASES[pending] ?? pending)) {
      id = pending;
    }
  }
  if (!id || !label.trim()) return { label };
  const canonical = SLOT_ALIASES[id] ?? id;
  if (!CANONICAL_SLOT_IDS.has(canonical) && !canonical.startsWith("custom:")) return { label };
  return { slot: canonical, label };
}

/**
 * The legacy question vocabulary, still honoured because an old session's state,
 * a cached transcript or a third-party client can carry it. Each entry maps a
 * prefix to the slot it fills; the remainder of the string is the label except
 * where a normalisation is needed (risk is a yes/no, impact is a key).
 */
const LEGACY_PREFIXES: {
  prefix: string;
  slot: string;
  label: (rest: string) => string;
}[] = [
  { prefix: "for:", slot: "raisedFor", label: (r) => r },
  { prefix: "class:", slot: "classInfo", label: (r) => r },
  { prefix: "loc:", slot: "location", label: (r) => r },
  { prefix: "sys:", slot: "systemAffected", label: (r) => r },
  { prefix: "when:", slot: "occurredAt", label: (r) => r },
  { prefix: "impact:", slot: "impact", label: (r) => r },
  { prefix: "freq:", slot: "frequency", label: (r) => r },
  { prefix: "risk:", slot: "atRisk", label: (r) => (/^y/i.test(r) ? "Yes" : "No") },
  { prefix: "mem:", slot: "membershipRef", label: (r) => r },
  { prefix: "membership:", slot: "membershipRef", label: (r) => r },
  { prefix: "studio:none", slot: "studio", label: () => "Not studio specific" },
  { prefix: "unknown", slot: "notes", label: () => "Not identified" },
];

/**
 * Parse any option value the UI can render into a slot + a label the transcript
 * can read. Never returns an empty label for a recognised value, and never
 * throws for an unrecognised one — the caller sees words only.
 */
export function parseOptionValue(value: string, pendingQuestionId?: string | null): ParsedOption {
  if (!value) return { label: "" };
  if (value.startsWith("ans:")) return parseAnsValue(value, pendingQuestionId);

  // Multi-select pickers carry their own shapes.
  if (value.startsWith("sessions:") || value.startsWith("members:")) return { label: "" };

  if (value === "studio:none") return { slot: "studio", label: "Not studio specific" };
  if (value.startsWith("studio:")) {
    // `studio:<id>` (gate buttons) and `studio:<id>:<name>, <city>` (picker).
    const parts = value.split(":");
    const name = parts.slice(2).join(":").trim();
    return { slot: "studio", label: name || parts[1] || "" };
  }
  if (value.startsWith("session:")) {
    const [, , ...rest] = value.split(":");
    const [name, at, teacher] = rest.join(":").split("|");
    const label = [name, at, teacher && `taught by ${teacher}`].filter(Boolean).join(", ");
    return { slot: "classInfo", label };
  }
  if (value.startsWith("member:")) {
    const [, id, ...rest] = value.split(":");
    return { slot: "member", label: rest.length ? rest.join(":") : id };
  }
  if (value.startsWith("trainer:")) return { slot: "trainer", label: value.slice(8) };
  if (value.startsWith("cat:")) return { slot: "category", label: value.slice(4) };
  if (value.startsWith("sub:")) return { slot: "subcategory", label: value.slice(4) };
  if (value === "resolvedNow:yes") return { slot: "resolvedNow", label: "Yes — resolved" };
  if (value === "resolvedNow:no") return { slot: "resolvedNow", label: "No — still happening" };

  for (const entry of LEGACY_PREFIXES) {
    if (value.startsWith(entry.prefix)) {
      const rest = value.slice(entry.prefix.length);
      return { slot: entry.slot, label: entry.label(rest) };
    }
  }
  return { label: "" };
}

/** Words for an option value, for the transcript the agent re-reads. */
export function optionValueToWords(value: string, studioName?: string): string {
  if (value === "skip") return "Skip that one.";
  if (value === "browse") return "Let me pick the category myself.";
  if (value === "showall") return "Show me all the options.";
  if (value.startsWith("prio:")) return `Priority: ${value.slice(5)}.`;
  const parsed = parseOptionValue(value);
  if (!parsed.label) return "";
  if (parsed.slot === "studio") {
    if (/not studio/i.test(parsed.label)) return "This is not studio specific.";
    return `The studio is ${studioName ?? parsed.label}.`;
  }
  if (parsed.slot === "raisedFor") return `Raised for: ${parsed.label}.`;
  if (parsed.slot === "classInfo") return `The class was ${parsed.label}.`;
  if (parsed.slot === "location") return `It happened in the ${parsed.label}.`;
  if (parsed.slot === "systemAffected") return `The system affected is ${parsed.label}.`;
  if (parsed.slot === "occurredAt") return `It happened ${parsed.label.toLowerCase()}.`;
  if (parsed.slot === "impact") return `Impact: ${parsed.label}.`;
  if (parsed.slot === "atRisk") return /^y/i.test(parsed.label) ? "Someone is at risk right now." : "No immediate risk.";
  if (parsed.slot === "frequency") return `Frequency: ${parsed.label}.`;
  if (parsed.slot === "membershipRef") return `Membership: ${parsed.label}.`;
  if (parsed.slot === "trainer") return `The trainer was ${parsed.label}.`;
  if (parsed.slot === "member") return `The member is ${parsed.label}.`;
  if (parsed.slot === "resolvedNow") return /^y/i.test(parsed.label) ? "It is resolved / fixed now." : "It is still happening — not resolved.";
  if (parsed.slot === "category") return `File this under ${parsed.label}.`;
  if (parsed.slot === "subcategory") return `The subcategory is ${parsed.label}.`;
  return parsed.label;
}
