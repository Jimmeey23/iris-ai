import { classify } from "./ai";
import { CATEGORIES, PRIORITIES, TAXONOMY, type Priority } from "./taxonomy";

/**
 * Deterministic rails around the LLM. The model decides wording, questions and
 * judgement; these rules decide what is *allowed* to reach a ticket.
 */

/** Words that set a priority floor the model can raise but never lower. */
const CRITICAL_SIGNALS =
  /\b(injur|injured|hurt her|hurt his|hurt their|got hurt|bleeding|fainted|unconscious|collaps|ambulance|hospital|fire|smoke|electrocut|electric shock|harass|assault|molest|abuse|threat(en)?|police|evacuat|blocked exit|gas leak|short circuit)\w*/i;
const HIGH_SIGNALS =
  /\b(unsafe|danger|hazard|slipped|fell|trip(ped)?|flood|leak|no power|power (cut|outage|failure)|outage|stuck in|locked in|theft|stolen|missing wallet|chargeback|refund demand|wants a refund|demanding a refund|charged twice|double charg|duplicate charg|billed twice|overcharg|legal|lawyer|media|social post)\w*/i;

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

/** Slots that must be present before a ticket can be raised. */
export function missingRequired(data: { studioName?: string; rawText?: string }): string[] {
  const missing: string[] = [];
  if (!data.rawText || data.rawText.trim().length < 3) missing.push("rawText");
  if (data.studioName === undefined) missing.push("studio");
  return missing;
}

/** Trim any model prose that runs long or slips into bullet-point mode. */
export function tidyReply(reply: string | undefined, fallback: string): string {
  const clean = (reply ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  if (clean.length <= 400) return clean;
  return `${clean.slice(0, 397).replace(/[,;:.\s]+$/, "")}…`;
}
