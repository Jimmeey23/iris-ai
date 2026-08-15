import { CATEGORIES, CATEGORY_META, TAXONOMY } from "./taxonomy";
import { MEMBERSHIPS, STUDIO_AREAS, SYSTEMS, OCCURRED_OPTIONS } from "./catalog";
import { classify } from "./ai";
import { CATEGORY_DEPARTMENT } from "./org";

export type ContextTabKey =
  | "category" | "studio" | "member" | "class" | "trainer" | "membership"
  | "area" | "when" | "impact" | "priority" | "department" | "source" | "tags";

export type SuggestionSet = {
  /** Tabs worth showing first for this situation. */
  order: ContextTabKey[];
  /** Tabs that make no sense and should be hidden. */
  hidden: ContextTabKey[];
  /** Context-aware shortlists per tab. */
  options: Partial<Record<ContextTabKey, string[]>>;
  /** Inline nudges shown under the bar. */
  hints: string[];
};

const ALL_TABS: ContextTabKey[] = [
  "category", "studio", "member", "class", "trainer", "membership",
  "area", "when", "impact", "priority", "department", "source", "tags",
];

export const IMPACT_LABELS = [
  "Safety risk / classes blocked",
  "Several members affected",
  "One member / minor disruption",
  "Suggestion or improvement",
];

export const PRIORITY_LABELS = ["Critical", "High", "Medium", "Low"];
export const SOURCE_LABELS = [
  "Reported at front desk",
  "WhatsApp message",
  "Phone call",
  "Email",
  "Instagram / social",
  "Noticed by staff",
  "Momence app",
  "Google review",
];

const TAG_BANK: Record<string, string[]> = {
  "Safety and Security": ["incident-report", "compliance", "escalate-now", "cctv-pulled", "insurance"],
  "Theft and Lost Items": ["investigation", "cctv-pulled", "lost-and-found", "police-report", "high-value"],
  "Pricing and Memberships": ["billing", "refund-requested", "retention-risk", "finance-review", "auto-debit"],
  "Repair and Maintenance": ["vendor-required", "recurring-fault", "asset-replacement", "preventive", "class-blocking"],
  "Trainer Feedback": ["coaching-plan", "recurring", "recognition", "roster-review", "formal-review"],
  "Class Experience": ["format-review", "capacity", "member-experience", "playlist", "programming"],
  "Tech Issues": ["hardware", "downtime", "vendor-required", "backup-used", "class-blocking"],
  "Operating Systems": ["platform-bug", "vendor-ticket", "data-integrity", "downtime"],
  "Customer Service and Communication": ["service-recovery", "response-sla", "follow-up-due", "escalated"],
  "Studio Amenities and Facilities": ["housekeeping", "consumables", "member-experience", "deep-clean"],
  "Brand Feedback": ["brand-guidelines", "merch", "campaign", "social"],
  Scheduling: ["timetable", "demand-signal", "capacity", "trial-slot"],
  Miscellaneous: ["ambience", "quick-win", "follow-up-due"],
};

const AREA_BY_HINT: { re: RegExp; areas: string[] }[] = [
  { re: /shower|washroom|toilet|bathroom|water/i, areas: ["Showers / washroom", "Locker room", "Back office"] },
  { re: /locker|bag|belongings/i, areas: ["Locker room", "Showers / washroom", "Reception / lobby"] },
  { re: /desk|reception|check.?in|lobby|queue/i, areas: ["Reception / lobby", "Member lounge", "Boutique"] },
  { re: /cycle|bike|spin/i, areas: ["Cycle studio", "Main studio floor"] },
  { re: /strength|weights|rig|dumbbell/i, areas: ["Strength Lab floor", "Main studio floor"] },
  { re: /valet|parking|car/i, areas: ["Parking / valet", "Reception / lobby"] },
  { re: /boutique|merch|retail/i, areas: ["Boutique", "Reception / lobby"] },
  { re: /class|barre|mat|floor|mirror|barre bar/i, areas: ["Main studio floor", "Studio 2", "Cycle studio"] },
];

const SYSTEM_BY_HINT: { re: RegExp; systems: string[] }[] = [
  { re: /momence|booking|roster|check.?in/i, systems: ["Momence", "Front desk iPad", "Wi-Fi / router"] },
  { re: /pay|charge|card|razorpay|stripe|pos/i, systems: ["Payment gateway (Stripe / Razorpay)", "POS / card machine", "Momence"] },
  { re: /mic|speaker|sound|audio|music/i, systems: ["Audio / mic system"] },
  { re: /wifi|wi-fi|internet|network|router/i, systems: ["Wi-Fi / router", "Front desk iPad"] },
  { re: /cctv|camera|surveillance/i, systems: ["CCTV / surveillance", "Access control / door lock"] },
  { re: /app|website|online/i, systems: ["Website / mobile app", "Momence"] },
];

const MEMBERSHIP_BY_HINT: { re: RegExp; match: RegExp }[] = [
  { re: /cycle|bike|spin/i, match: /^powerCycle/ },
  { re: /strength|weights|lab/i, match: /^Strength Lab/ },
  { re: /barre/i, match: /^Barre/ },
  { re: /private|1.?on.?1|personal/i, match: /Private|Virtual/ },
  { re: /trial|newcomer|intro|first class/i, match: /Newcomers|Trial|2 Week/ },
  { re: /annual|year/i, match: /Annual/ },
  { re: /pack|credits|class pack/i, match: /Pack|Package/ },
];

/**
 * Reads the draft text plus whatever has already been chosen and returns a
 * shortlist for each context tab, so nothing generic is ever shown first.
 */
export function suggestContext(input: {
  text: string;
  category?: string;
  subcategory?: string;
}): SuggestionSet {
  const raw = (input.text ?? "").toLowerCase();
  const guessed = input.category ? null : classify(input.text ?? "", 3);
  const category = input.category ?? guessed?.[0]?.category;
  const options: SuggestionSet["options"] = {};
  const hidden: ContextTabKey[] = [];
  const hints: string[] = [];

  /* category shortlist */
  if (!input.category && guessed && guessed.length > 0) {
    options.category = [...new Set(guessed.map((g) => g.category))].slice(0, 4);
    hints.push(`Iris reads this as ${guessed[0].category} › ${guessed[0].subcategory}`);
  } else if (category) {
    const subs = TAXONOMY[category] ?? [];
    const ranked = input.text
      ? classify(input.text, 40).filter((c) => c.category === category).map((c) => c.subcategory)
      : [];
    options.category = [...new Set([...ranked, ...subs])].slice(0, 10);
  } else {
    options.category = CATEGORIES.slice(0, 8);
  }

  /* area shortlist */
  const areaHit = AREA_BY_HINT.find((a) => a.re.test(raw));
  options.area = areaHit ? [...areaHit.areas, ...STUDIO_AREAS.filter((s) => !areaHit.areas.includes(s))] : STUDIO_AREAS;
  if (areaHit) hints.push(`Likely area: ${areaHit.areas[0]}`);

  /* system shortlist */
  const sysHit = SYSTEM_BY_HINT.find((s) => s.re.test(raw));
  if (sysHit) hints.push(`System involved: ${sysHit.systems[0]}`);

  /* membership shortlist */
  const memHit = MEMBERSHIP_BY_HINT.find((m) => m.re.test(raw));
  options.membership = memHit
    ? [...MEMBERSHIPS.filter((m) => memHit.match.test(m)), ...MEMBERSHIPS.filter((m) => !memHit.match.test(m))]
    : MEMBERSHIPS;

  /* when shortlist — reorder by tense cues */
  const nowish = /right now|currently|as we speak|just now|happening/.test(raw);
  const past = /yesterday|last week|earlier|previously/.test(raw);
  const recurring = /again|every|keeps|repeatedly|always|daily|weekly/.test(raw);
  options.when = recurring
    ? ["Ongoing / recurring", ...OCCURRED_OPTIONS.filter((o) => o !== "Ongoing / recurring")]
    : nowish
      ? ["Just now", ...OCCURRED_OPTIONS.filter((o) => o !== "Just now")]
      : past
        ? ["Yesterday", "Earlier this week", ...OCCURRED_OPTIONS.filter((o) => !["Yesterday", "Earlier this week"].includes(o))]
        : OCCURRED_OPTIONS;
  if (recurring) hints.push("Sounds recurring — flagging for root-cause review");

  /* impact + priority shortlist */
  const severe = /unsafe|danger|injur|emergency|harass|fire|theft|stolen|blocked|fainted/.test(raw);
  const many = /several|multiple|everyone|whole class|all members|many/.test(raw);
  options.impact = severe
    ? IMPACT_LABELS
    : many
      ? [IMPACT_LABELS[1], IMPACT_LABELS[2], IMPACT_LABELS[0], IMPACT_LABELS[3]]
      : [IMPACT_LABELS[2], IMPACT_LABELS[1], IMPACT_LABELS[3], IMPACT_LABELS[0]];
  options.priority = severe
    ? ["Critical", "High", "Medium", "Low"]
    : many
      ? ["High", "Medium", "Critical", "Low"]
      : ["Medium", "Low", "High", "Critical"];

  /* department */
  options.department = category
    ? [CATEGORY_DEPARTMENT[category] ?? "Operations", ...new Set(Object.values(CATEGORY_DEPARTMENT))].slice(0, 8)
    : [...new Set(Object.values(CATEGORY_DEPARTMENT))];

  /* source */
  const srcHit =
    /whatsapp/i.test(raw) ? "WhatsApp message" :
    /called|phone|rang/i.test(raw) ? "Phone call" :
    /email|mailed/i.test(raw) ? "Email" :
    /instagram|dm|social/i.test(raw) ? "Instagram / social" :
    /review|google/i.test(raw) ? "Google review" :
    /i (noticed|saw|found)/i.test(raw) ? "Noticed by staff" : null;
  options.source = srcHit ? [srcHit, ...SOURCE_LABELS.filter((s) => s !== srcHit)] : SOURCE_LABELS;

  /* tags */
  options.tags = category ? (TAG_BANK[category] ?? TAG_BANK.Miscellaneous) : TAG_BANK.Miscellaneous;

  /* hide tabs that don't apply */
  const meta = category ? CATEGORY_META[category] : undefined;
  const follow = meta?.followUps ?? [];
  const abstract = /Pricing|Brand|Customer Service|Scheduling/.test(category ?? "");
  if (abstract) hidden.push("area");
  if (!follow.includes("trainer") && !/trainer|instructor|coach/.test(raw)) hidden.push("trainer");
  if (!follow.includes("class") && !/class|session/.test(raw)) hidden.push("class");
  if (!follow.includes("membership") && !/member|pack|billing|charge/.test(raw)) hidden.push("membership");

  /* order tabs by relevance */
  const priorityOrder: ContextTabKey[] = ["category", "studio"];
  if (/member|client|she|he|they/.test(raw)) priorityOrder.push("member");
  if (follow.includes("class") || /class|session/.test(raw)) priorityOrder.push("class");
  if (follow.includes("trainer") || /trainer|instructor/.test(raw)) priorityOrder.push("trainer");
  if (!hidden.includes("area")) priorityOrder.push("area");
  if (!hidden.includes("membership")) priorityOrder.push("membership");
  priorityOrder.push("when", "impact", "priority", "department", "source", "tags");

  const order = [...new Set(priorityOrder)].filter((t) => !hidden.includes(t));
  for (const t of ALL_TABS) if (!order.includes(t) && !hidden.includes(t)) order.push(t);

  return { order, hidden, options, hints: hints.slice(0, 2) };
}

export const CONTEXT_SYSTEMS = SYSTEMS;
