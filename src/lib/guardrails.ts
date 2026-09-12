import { classify } from "./ai";
import { CATEGORIES, PRIORITIES, TAXONOMY, type Priority } from "./taxonomy";

/**
 * Deterministic rails around the LLM. The model decides wording, questions and
 * judgement; these rules decide what is *allowed* to reach a ticket.
 *
 * Floor policy (deliberately narrow): only unambiguous, factual safety events
 * and hard financial events set a floor. Judgement words ("threatened to
 * cancel", "wants a refund", "legal") are left to the model — a floor that
 * fires on polite English erodes trust in every priority it sets.
 */

/** Words that set a priority floor the model can raise but never lower. */
const CRITICAL_SIGNALS =
  /\b(injur|injured|hurt her|hurt his|hurt their|got hurt|bleeding|fainted|unconscious|collaps|ambulance|hospital|fire|smoke|electrocut|electric shock|harass|assault|molest|abuse|police|evacuat|blocked exit|gas leak|short circuit|weapon|knife)\w*/i;
const HIGH_SIGNALS =
  /\b(unsafe|danger|hazard|slipped|fell|trip(ped)?|flood|leak|no power|power (cut|outage|failure)|outage|stuck in|locked in|theft|stolen|missing wallet|chargeback|charged twice|double charg|duplicate charg|billed twice|overcharg)\w*/i;

export type PriorityFloor = { floor: Priority; reason?: string };

/** Lowest priority this report is permitted to carry, based on hard signals. */
export function priorityFloor(text: string): PriorityFloor {
  const critical = text.match(CRITICAL_SIGNALS);
  if (critical) return { floor: "Critical", reason: `safety signal "${critical[0]}"` };
  const high = text.match(HIGH_SIGNALS);
  if (high) return { floor: "High", reason: `severity signal "${high[0]}"` };
  return { floor: "Low" };
}

/** Apply the floor to a model-chosen priority. Only ever raises. */
export function enforcePriority(
  proposed: Priority | undefined,
  text: string,
  reasonIn?: string,
): { priority: Priority; reason: string } {
  const { floor, reason } = priorityFloor(text);
  const candidate: Priority = PRIORITIES.includes(proposed as Priority)
    ? (proposed as Priority)
    : "Medium";
  if (PRIORITIES.indexOf(floor) > PRIORITIES.indexOf(candidate)) {
    return {
      priority: floor,
      reason: [reasonIn, `raised to ${floor} by ${reason}`].filter(Boolean).join(" · "),
    };
  }
  return { priority: candidate, reason: reasonIn ?? "model assessment" };
}

/**
 * Hazard wording that can justify "someone is at risk right now".
 *
 * The model is capable of asserting atRisk on a report where nothing is wrong
 * — a renovation scheduled for next week, say — and atRisk is the strongest
 * escalation in the system: it forces Severe severity and the tightest
 * response clock. A live-danger claim therefore has to be backed by live-danger
 * words somewhere in the report.
 */
const HAZARD_SIGNAL =
  /\b(injur|hurt|bleed|faint|unconscious|collaps|trapped|fire|smoke|burn|shock|electrocut|exposed wire|live wire|gas leak|flood|slip|fell|falling|glass|sharp|blocked exit|fire exit|harass|assault|threat|intruder|unsafe|hazard|danger)/i;

/**
 * Downgrade an unsupported live-risk claim. Never upgrades: a reporter who
 * pressed the risk button is trusted, and only a machine guess is questioned.
 */
export function enforceAtRisk(proposed: boolean | undefined, text: string): boolean | undefined {
  if (proposed !== true) return proposed;
  return HAZARD_SIGNAL.test(text) ? true : undefined;
}

/**
 * Scheduled work is not an incident. Announcing a renovation three days out is
 * information the business needs, not something to be resolved inside the hour,
 * so a planned report with no hazard cannot outrank Medium however urgent the
 * model felt. A real hazard inside planned work (a live wire on site) still
 * escalates through the normal path.
 */
export function plannedWorkCeiling(
  priority: Priority,
  input: { plannedWork?: boolean; atRisk?: boolean; impact?: string; text: string },
): { priority: Priority; capped: boolean } {
  const hazardous = input.atRisk === true || input.impact === "safety" || HAZARD_SIGNAL.test(input.text);
  if (!input.plannedWork || hazardous) return { priority, capped: false };
  const ceiling: Priority = "Medium";
  if (PRIORITIES.indexOf(priority) <= PRIORITIES.indexOf(ceiling)) return { priority, capped: false };
  return { priority: ceiling, capped: true };
}

/** Urgency score must track the enforced priority, not drift from it. */
export function enforceUrgency(score: number | undefined, priority: Priority): number {
  const floorByPriority: Record<Priority, number> = { Critical: 85, High: 65, Medium: 35, Low: 5 };
  const capByPriority: Record<Priority, number> = { Critical: 100, High: 88, Medium: 68, Low: 45 };
  const raw = Number.isFinite(score) ? Math.round(Number(score)) : floorByPriority[priority];
  return Math.min(capByPriority[priority], Math.max(floorByPriority[priority], raw));
}

export type ResolvedClass = {
  category: string;
  subcategory: string;
  corrected: boolean;
};

/**
 * Force a model-proposed classification onto the real taxonomy. Falls back to
 * the on-device classifier, then to the category's own first entry.
 */
export function resolveClassification(
  category: string | undefined,
  subcategory: string | undefined,
  text: string,
): ResolvedClass {
  const catMatch = CATEGORIES.find((c) => c.toLowerCase() === (category ?? "").trim().toLowerCase());
  if (catMatch) {
    const list = TAXONOMY[catMatch] ?? [];
    const subMatch = list.find(
      (s) => s.toLowerCase() === (subcategory ?? "").trim().toLowerCase(),
    );
    if (subMatch) return { category: catMatch, subcategory: subMatch, corrected: false };

    // Category is valid, subcategory is not — rank within the category.
    const ranked = classify(text, 80).find((c) => c.category === catMatch);
    return {
      category: catMatch,
      subcategory: ranked?.subcategory ?? list[0] ?? "Miscellaneous",
      corrected: true,
    };
  }

  const guess = classify(text, 1)[0];
  if (guess) return { category: guess.category, subcategory: guess.subcategory, corrected: true };
  return {
    category: "Miscellaneous",
    subcategory: TAXONOMY["Miscellaneous"]?.[0] ?? "Miscellaneous",
    corrected: true,
  };
}

/** Default ceiling on intake length so nobody gets interrogated. */
export const MAX_QUESTIONS = 6;

/** Admin-configurable question budget, clamped to something sane. */
export async function questionBudget(): Promise<number> {
  const { getSetting } = await import("./settings");
  const raw = Number(await getSetting("ai_max_questions"));
  if (!Number.isFinite(raw) || raw <= 0) return MAX_QUESTIONS;
  return Math.max(1, Math.min(12, Math.round(raw)));
}

/**
 * Categories that are a live fault by definition. Only these can be asked the
 * operational questions — "is it fixed yet?", "how many members did it hit?"
 * Asking them of a compliment, a suggestion or a request for a new class is
 * exactly how the assistant came across as a form.
 */
const FAULT_CATEGORIES = new Set([
  "Repair and Maintenance",
  "Tech Issues",
  "Operating Systems",
  "Safety and Security",
  "Class Experience",
  "Theft and Lost Items",
  "Studio Amenities and Facilities",
]);

/** Categories where the report is feedback, not a fault. */
const NON_FAULT_CATEGORIES = new Set([
  "Trainer Feedback",
  "Brand Feedback",
  "Customer Service and Communication",
  "Pricing and Memberships",
  "Scheduling",
  "Miscellaneous",
]);

export function isFaultCategory(category?: string): boolean {
  if (!category) return false;
  if (NON_FAULT_CATEGORIES.has(category)) return false;
  if (FAULT_CATEGORIES.has(category)) return true;
  return false;
}

/**
 * Slots that must be present before a ticket can be raised — shaped by what the
 * report actually is.
 *
 * Requiring `impact` and `resolvedNow` of everything is what put a severity
 * question in front of a member's compliment about a class. A compliment has no
 * blast radius; a suggestion has no current state. Both still need a studio and
 * a subject, and a fault still needs to know whether it is live.
 *
 * `category` is optional so existing callers (and the old tests) keep the
 * fault-shaped behaviour they were written against.
 */
export function missingRequired(
  data: {
    studioName?: string;
    rawText?: string;
    impact?: string;
    resolvedNow?: boolean;
    plannedWork?: boolean;
    plannedWindow?: string;
  },
  category?: string,
): string[] {
  const missing: string[] = [];
  if (!data.rawText || data.rawText.trim().length < 3) missing.push("rawText");
  if (data.studioName === undefined) missing.push("studio");
  if (!isFaultCategory(category)) return missing;
  // Scheduled work has no live state to establish — its owner-critical gap is
  // the window, so it is handled below rather than in the generic order.
  if (data.plannedWork) {
    if (!data.plannedWindow) missing.push("plannedWindow");
    return missing;
  }
  if (data.impact === undefined) missing.push("impact");
  if (data.resolvedNow === undefined) missing.push("resolvedNow");
  return missing;
}

export const RAISED_FOR_VALUES = [
  "On behalf of a member",
  "Multiple members",
  "Noticed by staff",
  "Staff or trainer concern",
] as const;

/**
 * Force the model's free-form "raised for" wording onto the four values the
 * ticket UI and reports expect. Near-misses are mapped; anything unmappable
 * lands on "Noticed by staff" rather than an invented category.
 */
export function normaliseRaisedFor(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "Noticed by staff";
  if (RAISED_FOR_VALUES.some((r) => r.toLowerCase() === v.toLowerCase())) {
    return RAISED_FOR_VALUES.find((r) => r.toLowerCase() === v.toLowerCase())!;
  }
  const p = v.toLowerCase();
  if (/\b(multiple|several|many|a few|lots of)\b.*\b(members?|clients?|guests?|people)\b|^\bmultiple\b/.test(p)) {
    return "Multiple members";
  }
  if (/\bon behalf of\b/.test(p)) return "On behalf of a member";
  if (/\b(member|client|guest|customer)\b/.test(p) && /\b(complain|report|said|asked|upset|wants|raised|for a)\b/.test(p)) {
    return "On behalf of a member";
  }
  if (/\bstaff or trainer\b|\btrainer concern\b|\bteam concern\b/.test(p)) return "Staff or trainer concern";
  if (/\b(i|we|staff|front desk|manager|myself)\b.*\b(noticed|saw|found|observed|spotted|logged)\b|^\bi noticed\b|staff concern/.test(p)) {
    return "Noticed by staff";
  }
  if (/\b(member|client|guest|customer)\b/.test(p)) return "On behalf of a member";
  return "Noticed by staff";
}

/** Trim any model prose that runs long or slips into bullet-point mode. */
export function tidyReply(reply: string | undefined, fallback: string): string {
  const clean = (reply ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  if (clean.length <= 400) return clean;
  return `${clean.slice(0, 397).replace(/[,;:.\s]+$/, "")}…`;
}
