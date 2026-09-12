import { CATEGORY_META } from "./taxonomy";
import { CLASS_FORMATS, MEMBERSHIPS, OCCURRED_OPTIONS, STUDIO_AREAS, SYSTEMS } from "./catalog";
import { profileFor } from "./question-bank";
import type { ChatOption } from "./types";

export type SlotId =
  | "studio" | "raisedFor" | "member" | "memberContact" | "trainer" | "classInfo"
  | "location" | "systemAffected" | "membershipRef" | "occurredAt" | "impact"
  | "atRisk" | "frequency" | "actionTaken" | "witnesses" | "amount" | "notes";

export type DynamicQuestion = {
  slot: SlotId;
  prompt: string;
  helper?: string;
  options?: ChatOption[];
  allowFreeText: boolean;
  placeholder?: string;
  /** Momence-backed picker to surface instead of a plain text box. */
  picker?: "member" | "session" | "trainer" | "studio" | "membership";
  skipLabel?: string;
};

const IMPACT_OPTIONS: ChatOption[] = [
  { label: "Safety risk / classes blocked", value: "ans:impact|Safety risk / classes blocked", tone: "danger" },
  { label: "Several members affected", value: "ans:impact|Several members affected" },
  { label: "One member / minor disruption", value: "ans:impact|One member / minor disruption" },
  { label: "Suggestion or improvement", value: "ans:impact|Suggestion or improvement", tone: "ghost" },
];

const RAISED_FOR: ChatOption[] = [
  { label: "A member reported it", value: "ans:raisedFor|On behalf of a member" },
  { label: "I noticed it myself", value: "ans:raisedFor|Noticed by staff" },
  { label: "Multiple members raised it", value: "ans:raisedFor|Multiple members" },
  { label: "Staff / trainer concern", value: "ans:raisedFor|Staff or trainer concern" },
];

/** Slot catalogue with sensible defaults; prompts get rewritten per context. */
function baseQuestion(slot: SlotId): DynamicQuestion {
  switch (slot) {
    case "studio":
      return { slot, prompt: "Which studio does this relate to?", allowFreeText: false, picker: "studio" };
    case "raisedFor":
      return { slot, prompt: "Who is this being raised for?", options: RAISED_FOR, allowFreeText: false };
    case "member":
      return {
        slot,
        prompt: "Which member is this about?",
        helper: "Search live Momence records so billing and visit history attach automatically.",
        allowFreeText: true,
        picker: "member",
        placeholder: "Search Momence members…",
        skipLabel: "Keep anonymous",
      };
    case "memberContact":
      return { slot, prompt: "Best contact for follow-up?", allowFreeText: true, placeholder: "Phone or email", skipLabel: "Skip" };
    case "trainer":
      return {
        slot,
        prompt: "Which trainer was involved?",
        allowFreeText: true,
        picker: "trainer",
        placeholder: "Search trainers…",
        skipLabel: "Not trainer specific",
      };
    case "classInfo":
      return {
        slot,
        prompt: "Which class was this?",
        helper: "Pick the actual Momence session so date, time and teacher are exact.",
        allowFreeText: true,
        picker: "session",
        placeholder: "Search recent sessions…",
        options: CLASS_FORMATS.slice(0, 5).map((c) => ({ label: c, value: `ans:classInfo|${c}` })),
      };
    case "location":
      return {
        slot,
        prompt: "Where in the studio?",
        options: STUDIO_AREAS.slice(0, 8).map((a) => ({ label: a, value: `ans:location|${a}` })),
        allowFreeText: true,
      };
    case "systemAffected":
      return {
        slot,
        prompt: "Which system or device is affected?",
        options: SYSTEMS.map((s) => ({ label: s, value: `ans:systemAffected|${s}` })),
        allowFreeText: true,
      };
    case "membershipRef":
      return {
        slot,
        prompt: "Which membership or package?",
        helper: "Pulled from the Physique 57 product catalogue.",
        allowFreeText: true,
        picker: "membership",
        placeholder: "Search memberships…",
      };
    case "occurredAt":
      return {
        slot,
        prompt: "When did this happen?",
        options: OCCURRED_OPTIONS.map((o) => ({ label: o, value: `ans:occurredAt|${o}` })),
        allowFreeText: false,
      };
    case "impact":
      return { slot, prompt: "How wide is the impact?", helper: "Drives severity and SLA.", options: IMPACT_OPTIONS, allowFreeText: false };
    case "atRisk":
      return {
        slot,
        prompt: "Is anyone at risk or is this still happening right now?",
        options: [
          { label: "Yes — act immediately", value: "ans:atRisk|Yes", tone: "danger" },
          { label: "No immediate risk", value: "ans:atRisk|No" },
        ],
        allowFreeText: false,
      };
    case "frequency":
      return {
        slot,
        prompt: "Is this a one-off or has it happened before?",
        options: [
          { label: "First time", value: "ans:frequency|First time" },
          { label: "Second or third time", value: "ans:frequency|Repeat — 2-3 times" },
          { label: "Happens most weeks", value: "ans:frequency|Chronic — weekly" },
        ],
        allowFreeText: false,
      };
    case "actionTaken":
      return {
        slot,
        prompt: "What have you already done on the floor?",
        allowFreeText: true,
        placeholder: "e.g. moved members to Studio 2, apologised, offered a credit",
        skipLabel: "Nothing yet",
      };
    case "witnesses":
      return {
        slot,
        prompt: "Who else was present or can corroborate?",
        allowFreeText: true,
        placeholder: "Names of staff or members present",
        skipLabel: "No witnesses",
      };
    case "amount":
      return {
        slot,
        prompt: "What amount or transaction is in dispute?",
        allowFreeText: true,
        placeholder: "e.g. ₹12,500 charged twice on 5 Aug",
        skipLabel: "Not a specific amount",
      };
    case "notes":
      return {
        slot,
        prompt: "Anything else the owner should know?",
        allowFreeText: true,
        placeholder: "Additional context",
        skipLabel: "Nothing else — show the draft",
      };
  }
}

/**
 * Choose which slots matter for this specific report. Purely contextual —
 * two different issues never get the same question set.
 */
export function planSlots(input: {
  category: string;
  subcategory: string;
  text: string;
  known: Set<SlotId>;
}): SlotId[] {
  const { category, subcategory, text, known } = input;
  const sub = subcategory.toLowerCase();
  const raw = text.toLowerCase();
  const slots: SlotId[] = ["studio", "raisedFor"];

  // Only chase member identity when an individual member is actually the subject —
  // a passing mention of "clients" is not a reason to ask who they were.
  const staffObserved = /\bi (noticed|saw|found|observed|spotted)\b|not member specific/i.test(raw);
  const memberLed =
    !staffObserved &&
    (/\b(a|one|the) (member|client|guest|customer)\b/i.test(raw) ||
      /\b(member|client|guest|customer)\s+(complained|reported|said|says|told|asked|wants|is upset|flagged|demanded)/i.test(raw) ||
      category === "Pricing and Memberships");
  if (memberLed) slots.push("member", "memberContact");

  const meta = CATEGORY_META[category];
  const follow = meta?.followUps ?? [];

  if (follow.includes("trainer") || /\b(trainer|instructor|coach|teacher)\b/.test(raw)) slots.push("trainer");
  if (follow.includes("class") || /\b(class|session|batch|workout)\b/.test(raw)) slots.push("classInfo");

  const physical =
    follow.includes("location") ||
    /Repair|Amenities|Safety|Theft|Miscellaneous/.test(category);
  const abstract = /(charge|billing|refund|payment|policy|pricing|renewal|credits|membership|social|brand|website|app)/i.test(sub);
  if (physical && !abstract) slots.push("location");

  if (/Tech|Operating/.test(category) || /\b(system|app|application|wifi|wi-fi|mic|microphone|ipad|tablet|pos|momence|router|laptop|software|website|speaker)\b/.test(raw)) {
    slots.push("systemAffected");
  }
  if (category === "Pricing and Memberships" || /\b(membership|pack|credits|renewal|invoice|charged|refund)\b/.test(raw)) {
    slots.push("membershipRef", "amount");
  }
  if (category === "Safety and Security" || category === "Theft and Lost Items") {
    slots.push("atRisk", "witnesses");
  }
  if (/Trainer Feedback|Customer Service|Class Experience|Repair/.test(category)) {
    slots.push("frequency");
  }
  // What the floor already did is the single most useful line for the owner.
  if (/Safety|Theft|Repair|Tech|Customer Service|Class Experience|Operating|Amenities/.test(category)) {
    slots.push("actionTaken");
  }

  slots.push("occurredAt", "impact");

  const profile = profileFor(category, subcategory);
  for (const extra of profile.extraSlots ?? []) slots.push(extra);
  slots.push("notes");

  const dropped = new Set(profile.dropSlots ?? []);
  const seen = new Set<SlotId>();
  return slots.filter((s) => {
    if (known.has(s) || seen.has(s) || dropped.has(s)) return false;
    seen.add(s);
    return true;
  });
}

/** Impact wording differs per issue, but the stored key must stay stable. */
const IMPACT_KEYS = ["safety", "many", "single", "suggestion"];

function applyProfileOverride(q: DynamicQuestion, category: string, subcategory: string): DynamicQuestion {
  const profile = profileFor(category, subcategory);
  const override = profile.slots?.[q.slot];
  if (!override) return q;

  const out: DynamicQuestion = { ...q };
  if (override.prompt) out.prompt = override.prompt;
  if (override.helper) out.helper = override.helper;
  if (override.placeholder) out.placeholder = override.placeholder;

  if (override.options && override.options.length > 0) {
    if (q.slot === "impact") {
      out.options = override.options.map((label, i) => ({
        label,
        // The stored key must stay stable even when the wording changes.
        value: `ans:impact|${IMPACT_KEYS[Math.min(i, IMPACT_KEYS.length - 1)]}`,
        tone: i === 0 ? ("danger" as const) : undefined,
      }));
    } else if (q.slot === "atRisk") {
      out.options = override.options.map((label, i) => ({
        label,
        value: `ans:atRisk|${i === 0 ? "Yes" : "No"}`,
        tone: i === 0 ? ("danger" as const) : undefined,
      }));
      out.allowFreeText = false;
    } else {
      out.options = override.options.map((label) => ({
        label,
        value: `ans:${q.slot}|${label}`,
      }));
    }
  }
  return out;
}

export function issueIntro(category: string, subcategory: string): string | undefined {
  return profileFor(category, subcategory).intro;
}

/** Turn a taxonomy label into something you'd actually say out loud. */
function naturalNoun(subcategory: string): string {
  const s = subcategory.toLowerCase();
  if (/emergency|injury|medical|harass|first aid|panic|fire|exit/.test(s)) return "incident";
  if (/theft|stolen|lost|missing/.test(s)) return "loss";
  if (/charge|refund|billing|renewal|payment|pricing|pack|membership/.test(s)) return "billing issue";
  if (/trainer|instructor|punctual|behaviour|coaching/.test(s)) return "trainer issue";
  if (/class|session|overcrowd|pacing|format/.test(s)) return "class issue";
  if (/ac |hvac|equipment|plumb|light|repair|broken|maintenance/.test(s)) return "fault";
  if (/clean|hygiene|odour|smell|towel|supplies|shower|locker/.test(s)) return "housekeeping issue";
  if (/wifi|system|software|app|pos|momence|mic|speaker|device|crm/.test(s)) return "technical fault";
  if (/schedul|timing|waitlist|capacity|booking/.test(s)) return "scheduling request";
  if (/response|complaint|front desk|communication|follow-up/.test(s)) return "service issue";
  return "issue";
}

/** Rewrite the prompt so it references the concrete situation. */
function contextualise(q: DynamicQuestion, ctx: { subcategory: string; studio?: string; member?: string; trainer?: string }): DynamicQuestion {
  const sub = naturalNoun(ctx.subcategory);
  const out = { ...q };
  switch (q.slot) {
    case "location":
      out.prompt = `Whereabouts in the studio did this happen?`;
      break;
    case "trainer":
      out.prompt = ctx.member
        ? `Which trainer was leading the class ${ctx.member} is referring to?`
        : "Which trainer was leading?";
      break;
    case "classInfo":
      out.prompt = ctx.trainer ? `Which of ${ctx.trainer}'s sessions was this?` : "Which class was this?";
      break;
    case "impact":
      out.prompt = `How far does this ${sub} reach?`;
      break;
    case "occurredAt":
      out.prompt = `When did this happen?`;
      break;
    case "actionTaken":
      out.prompt = `Anything you've already done on the floor?`;
      break;
    case "member":
      out.prompt = ctx.studio ? `Which member at ${ctx.studio.split(",")[0]} is this for?` : q.prompt;
      break;
    case "frequency":
      out.prompt = `Has this come up before, or is it a one-off?`;
      break;
  }
  return out;
}

export function buildQuestion(
  slot: SlotId,
  ctx: { category?: string; subcategory: string; studio?: string; member?: string; trainer?: string },
): DynamicQuestion {
  const base = contextualise(baseQuestion(slot), ctx);
  return applyProfileOverride(base, ctx.category ?? "", ctx.subcategory);
}

export const MEMBERSHIP_OPTIONS = MEMBERSHIPS;
