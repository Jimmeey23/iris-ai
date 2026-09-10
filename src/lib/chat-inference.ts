import { extractPerson, extractStudio } from "./ai";
import { CATEGORIES, PRIORITIES, TAXONOMY, type Priority } from "./taxonomy";
import type { ComposerContext } from "./types";
import { markSlotSource, type EngineContext, type IntakeState } from "./chat-engine";

export const CLASS_FORMATS = [
  "Barre 57", "Cardio Barre", "Studio FIT", "Mat 57", "Power Cycle", "Private Session", "Not class specific",
];

export const LOCATIONS = [
  "Main studio floor", "Studio 2", "Reception / lobby", "Locker room", "Showers / washroom",
  "Member lounge", "Boutique", "Parking / valet", "Other area",
];

export const SYSTEMS = [
  "Momence", "POS / card machine", "Wi-Fi / router", "Front desk iPad", "Website / mobile app",
  "Payment gateway (Stripe / Razorpay)", "Audio / mic system", "CCTV / surveillance", "Other system",
];

export const MEMBERSHIPS = [
  "Unlimited monthly", "Class pack (10 / 20)", "Annual membership", "Private sessions",
  "Trial / intro offer", "Not applicable",
];

export const IMPACT_OPTIONS = [
  { label: "🚨 Safety risk or classes blocked", value: "impact:safety", key: "safety" },
  { label: "👥 Several members affected", value: "impact:many", key: "many" },
  { label: "👤 One member / minor disruption", value: "impact:single", key: "single" },
  { label: "💡 Suggestion or improvement idea", value: "impact:suggestion", key: "suggestion" },
];

export const IMPACT_LABEL: Record<string, string> = {
  safety: "Safety risk / classes blocked",
  many: "Several members affected",
  single: "One member / minor disruption",
  suggestion: "Suggestion or idea",
};

/* ------------------------------------------------------------------ */
/* Inference from free text — so we never re-ask what was already said */
/* ------------------------------------------------------------------ */

const WHEN_PATTERNS: { re: RegExp; value: string }[] = [
  { re: /\b(right now|happening now|as we speak|currently|at the moment)\b/i, value: "Just now" },
  { re: /\b(just now|a few minutes ago|minutes ago)\b/i, value: "Just now" },
  { re: /\b(this morning|this afternoon|this evening|today|earlier today|tonight)\b/i, value: "Earlier today" },
  { re: /\byesterday\b/i, value: "Yesterday" },
  { re: /\b(this week|earlier this week|couple of days ago|two days ago|last few days)\b/i, value: "Earlier this week" },
  { re: /\b(every day|daily|ongoing|recurring|again and again|keeps happening|for \d+ (days|weeks)|since last week|repeatedly|every class)\b/i, value: "Ongoing / recurring" },
  { re: /\blast (week|month)\b/i, value: "Earlier this week" },
  // Bare clock times with no day marker read as today on a studio floor.
  { re: /\b\d{1,2}[.:]?\d{0,2}\s?(am|pm)\b/i, value: "Earlier today" },
];

const RAISED_FOR_PATTERNS: { re: RegExp; value: string }[] = [
  { re: /\b(several|multiple|many|three|four|five|a few|some) (members|clients|guests|people|ladies)\b/i, value: "Multiple members" },
  { re: /\b(members|clients|guests) (are|have|keep|said|complained|asked)\b/i, value: "Multiple members" },
  { re: /\b(a )?(member|client|guest|customer|she|he)\s+(complained|reported|said|says|told|mentioned|asked|wants|is upset|flagged)/i, value: "On behalf of a member" },
  { re: /\bon behalf of\b/i, value: "On behalf of a member" },
  { re: /\bi (noticed|saw|found|observed|spotted)\b/i, value: "Noticed by staff" },
  { re: /\b(trainer|instructor|staff|team member|front desk)\s+(raised|reported|flagged|is|has)\b/i, value: "Staff or trainer concern" },
];

const IMPACT_PATTERNS: { re: RegExp; key: string }[] = [
  { re: /\b(unsafe|danger|injur|emergency|evacuat|fire|blocked exit|electric|fainted|collapsed|bleeding|harass)/i, key: "safety" },
  { re: /\b(whole class|entire class|all members|several members|multiple members|everyone|many members|both studios)\b/i, key: "many" },
  { re: /\b(suggest|idea|would be nice|recommend|request for|it would help|proposal)\b/i, key: "suggestion" },
  { re: /\b(a member|one member|she|he) (complained|reported|said|asked)\b/i, key: "single" },
];

const LOCATION_PATTERNS: { re: RegExp; value: string }[] = [
  { re: /\b(locker ?room|lockers?)\b/i, value: "Locker room" },
  { re: /\b(shower|washroom|toilet|restroom|bathroom)\b/i, value: "Showers / washroom" },
  { re: /\b(reception|front desk|lobby|entrance)\b/i, value: "Reception / lobby" },
  { re: /\b(lounge|waiting area)\b/i, value: "Member lounge" },
  { re: /\b(boutique|retail|merch(andise)? (rack|display))\b/i, value: "Boutique" },
  { re: /\b(valet|parking|car ?park)\b/i, value: "Parking / valet" },
  { re: /\bstudio ?2\b/i, value: "Studio 2" },
  { re: /\b(main studio|studio floor|studio ?1|class ?room|inside class|during class)\b/i, value: "Main studio floor" },
];

const SYSTEM_PATTERNS: { re: RegExp; value: string }[] = [
  { re: /\bmomence|moments notice\b/i, value: "Momence" },
  { re: /\b(pos|card machine|swipe machine|billing machine)\b/i, value: "POS / card machine" },
  { re: /\b(wi-?fi|router|internet|network)\b/i, value: "Wi-Fi / router" },
  { re: /\bipad|tablet\b/i, value: "Front desk iPad" },
  { re: /\b(website|mobile app|the app)\b/i, value: "Website / mobile app" },
  { re: /\b(stripe|razorpay|payment gateway)\b/i, value: "Payment gateway (Stripe / Razorpay)" },
  { re: /\b(mic|microphone|speaker|audio|sound system|music system)\b/i, value: "Audio / mic system" },
  { re: /\b(cctv|camera|surveillance)\b/i, value: "CCTV / surveillance" },
];

const MEMBERSHIP_PATTERNS: { re: RegExp; value: string }[] = [
  { re: /\bunlimited\b/i, value: "Unlimited monthly" },
  { re: /\b(\d+\s*(class|session)s? pack|class pack|credits?)\b/i, value: "Class pack (10 / 20)" },
  { re: /\bannual|yearly\b/i, value: "Annual membership" },
  { re: /\bprivate (session|training)\b/i, value: "Private sessions" },
  { re: /\b(trial|intro offer|introductory)\b/i, value: "Trial / intro offer" },
];

const RISK_YES = /\b(unsafe|still happening|right now|danger|injur|bleeding|fainted|collapsed|fire|emergency|harass|assault|trapped|electric shock)\b/i;
const NO_RISK = /\b(no one was hurt|nobody hurt|no injury|not urgent|no one is at risk)\b/i;

const STOP_NAMES = new Set([
  "Member", "Client", "Guest", "Customer", "She", "He", "They", "Someone", "Trainer",
  "Instructor", "Coach", "Studio", "Class", "Staff", "Front", "The", "This", "That", "Our",
]);
const MEMBER_NAME_RE =
  /\b(?:member|client|guest)\s+(?:named\s+|called\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)|\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+)?)\s+(?:complained|reported|said|mentioned|asked|wants|is upset|has asked)/;

const MEMBER_TIME_RE = /\b(\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i;

/** Read every field we can from the reporter's own words. */
export function inferFromText(text: string, s: IntakeState, ctx: EngineContext): string[] {
  const d = s.data;
  const found: string[] = [];
  const note = (label: string) => found.push(label);

  if (d.studioName === undefined) {
    const studio = extractStudio(text, ctx.studios);
    if (studio) {
      const full = ctx.studios.find((x) => x.id === studio.id)!;
      d.studioId = full.id;
      d.studioName = `${full.name}, ${full.city}`;
      note(`Studio · ${full.name}`);
    }
  }
  if (d.occurredAt === undefined) {
    const hit = WHEN_PATTERNS.find((p) => p.re.test(text));
    if (hit) {
      d.occurredAt = hit.value;
      note(`When · ${hit.value}`);
    }
  }
  if (d.raisedFor === undefined) {
    const hit = RAISED_FOR_PATTERNS.find((p) => p.re.test(text));
    if (hit) {
      d.raisedFor = hit.value;
      note(`Raised for · ${hit.value}`);
    }
  }
  if (d.impact === undefined) {
    const hit = IMPACT_PATTERNS.find((p) => p.re.test(text));
    if (hit) {
      d.impact = hit.key;
      note(`Impact · ${IMPACT_LABEL[hit.key]}`);
    }
  }
  if (d.location === undefined) {
    const hit = LOCATION_PATTERNS.find((p) => p.re.test(text));
    if (hit) {
      d.location = hit.value;
      note(`Location · ${hit.value}`);
    }
  }
  if (d.systemAffected === undefined) {
    const hit = SYSTEM_PATTERNS.find((p) => p.re.test(text));
    if (hit) {
      d.systemAffected = hit.value;
      note(`System · ${hit.value}`);
    }
  }
  if (d.membershipRef === undefined) {
    const hit = MEMBERSHIP_PATTERNS.find((p) => p.re.test(text));
    if (hit) {
      d.membershipRef = hit.value;
      note(`Membership · ${hit.value}`);
    }
  }
  if (d.trainerName === undefined) {
    const person = extractPerson(text);
    if (person) {
      d.trainerName = person;
      note(`Trainer · ${person}`);
    }
  }
  if (d.memberName === undefined) {
    const m = text.match(MEMBER_NAME_RE);
    const name = m?.[1] ?? m?.[2];
    if (name && name !== d.trainerName && !STOP_NAMES.has(name.split(" ")[0])) {
      d.memberName = name;
      note(`Member · ${name}`);
    }
  }
  if (d.classInfo === undefined) {
    // A single report often spans several classes — keep all of them.
    const times = [...text.matchAll(/\b(\d{1,2}[.:]?\d{0,2}\s?(?:am|pm))\b/gi)].map((m) =>
      m[1].toUpperCase().replace(/\s+/g, " "),
    );
    const formats = CLASS_FORMATS.filter(
      (f) => f !== "Not class specific" && text.toLowerCase().includes(f.toLowerCase()),
    );
    const legacyTime = text.match(MEMBER_TIME_RE)?.[1];
    const uniqueTimes = [...new Set(times.length ? times : legacyTime ? [legacyTime.toUpperCase()] : [])];
    if (uniqueTimes.length || formats.length) {
      const value =
        uniqueTimes.length && formats.length
          ? `${uniqueTimes.join(", ")} (${formats.join(", ")})`
          : uniqueTimes.length
            ? uniqueTimes.join(", ")
            : formats.join(", ");
      d.classInfo = value;
      note(`Class · ${d.classInfo}`);
    }
  }
  if (d.atRisk === undefined) {
    if (RISK_YES.test(text)) {
      d.atRisk = true;
      note("Immediate risk · Yes");
    } else if (NO_RISK.test(text)) {
      d.atRisk = false;
      note("Immediate risk · No");
    }
  }
  return found;
}

/** Apply structured context chosen in the composer context bar. */
export function applyComposerContext(context: ComposerContext, s: IntakeState): string[] {
  const d = s.data;
  const found: string[] = [];
  if (context.studioName) {
    d.studioId = context.studioId ?? null;
    d.studioName = context.studioName;
    markSlotSource(s, "studio", "context");
    found.push(`Studio · ${context.studioName}`);
  }
  if (context.memberName) {
    d.memberName = context.memberName;
    d.raisedFor = d.raisedFor ?? "On behalf of a member";
    markSlotSource(s, ["member", "raisedFor"], "context");
    found.push(`Member · ${context.memberName}`);
  }
  if (context.memberContact) d.memberContact = context.memberContact;
  if (context.memberId) d.momenceMemberId = context.memberId;
  if (context.trainerName) {
    d.trainerName = context.trainerName;
    markSlotSource(s, "trainerName", "context");
    found.push(`Trainer · ${context.trainerName}`);
  }
  if (context.classInfo) {
    d.classInfo = context.classInfo;
    markSlotSource(s, "classInfo", "context");
    found.push(`Class · ${context.classInfo}`);
  }
  if (context.classAt) {
    d.classAt = context.classAt;
    d.occurredAt = d.occurredAt ?? describeWhen(context.classAt);
    found.push(`Class time · ${context.classAt}`);
  }
  if (context.sessionId) {
    d.momenceSessionId = context.sessionId;
    markSlotSource(s, "momenceSessionId", "context");
  }
  if (context.membershipRef) {
    d.membershipRef = context.membershipRef;
    markSlotSource(s, "membershipRef", "context");
    found.push(`Membership · ${context.membershipRef}`);
  }
  // Composer values are client-supplied: only real taxonomy entries may pass,
  // otherwise a tampered payload could steer classification or priority.
  if (context.category && CATEGORIES.includes(context.category)) {
    d.category = context.category;
    found.push(`Category · ${context.category}`);
  }
  if (context.subcategory && context.category && (TAXONOMY[context.category] ?? []).includes(context.subcategory)) {
    d.subcategory = context.subcategory;
    found.push(`Subcategory · ${context.subcategory}`);
  }
  if (context.raisedFor) d.raisedFor = context.raisedFor;
  if (context.occurredAt) d.occurredAt = context.occurredAt;
  if (context.location) d.location = context.location;
  if (context.impact) {
    const map: Record<string, string> = {
      "Safety risk / classes blocked": "safety",
      "Several members affected": "many",
      "One member / minor disruption": "single",
      "Suggestion or improvement": "suggestion",
    };
    d.impact = map[context.impact] ?? context.impact;
    found.push(`Impact · ${context.impact}`);
  }
  if (context.priority && PRIORITIES.includes(context.priority as Priority)) {
    d.priorityOverride = context.priority as Priority;
    markSlotSource(s, "priorityOverride", "context");
    found.push(`Priority · ${context.priority}`);
  }
  if (context.source) {
    d.notes = d.notes ? `${d.notes} Source: ${context.source}.` : `Source: ${context.source}.`;
    found.push(`Source · ${context.source}`);
  }
  if (context.tags?.length) found.push(`Tags · ${context.tags.length}`);
  if (context.momenceContext) d.momenceContext = context.momenceContext;
  return found;
}

export function describeWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "Upcoming";
  if (diff < 4 * 3600000) return "Just now";
  if (diff < 24 * 3600000) return "Earlier today";
  if (diff < 48 * 3600000) return "Yesterday";
  if (diff < 8 * 86400000) return "Earlier this week";
  return "Earlier";
}
