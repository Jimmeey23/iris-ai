import { classify, extractStudio } from "./ai";
import { localEnrich, type AiInsight } from "./enrich";
import { CATEGORIES, CATEGORY_META, TAXONOMY, metaFor, type Priority } from "./taxonomy";
import { CATEGORY_DEPARTMENT } from "./org";
import { suggestOwner } from "./issue-knowledge";
import { buildQuestion, issueIntro, planSlots, type SlotId } from "./dynamic-chat";
import { WHY, ack, closingLine, coachTip, progressNote, reactTo, timeGreeting } from "./conversation";
import type { ChatMessage, ChatOption, ComposerContext, MomenceContext, TicketDraft } from "./types";
import {
  CLASS_FORMATS,
  IMPACT_LABEL,
  IMPACT_OPTIONS,
  LOCATIONS,
  MEMBERSHIPS,
  SYSTEMS,
  applyComposerContext,
  inferFromText,
} from "./chat-inference";

export type EngineStudio = {
  id: number;
  name: string;
  code: string;
  city: string;
  isHq: boolean;
  /** Lets Momence lookups be scoped to the right physical location. */
  momenceLocationId?: number | null;
};

export type EngineContext = {
  studios: EngineStudio[];
  reporter: { name: string; role: string };
};

export type IntakeData = {
  rawText?: string;
  category?: string;
  subcategory?: string;
  studioId?: number | null;
  studioName?: string;
  raisedFor?: string;
  memberName?: string;
  memberContact?: string;
  momenceMemberId?: number;
  momenceSessionId?: number;
  /** Every Momence session the incident hit, when it spanned more than one. */
  momenceSessionIds?: number[];
  /** Members picked off the real rosters of those sessions. */
  affectedMembers?: string;
  trainerName?: string;
  classInfo?: string;
  classAt?: string;
  location?: string;
  systemAffected?: string;
  membershipRef?: string;
  atRisk?: boolean;
  occurredAt?: string;
  impact?: string;
  /** Whether the fault is fixed at reporting time — the owner's first question. */
  resolvedNow?: boolean;
  /** Scheduled work announced in advance, rather than something that broke. */
  plannedWork?: boolean;
  /** The window that work covers, in the reporter's words ("From the 14th for 10 days"). */
  plannedWindow?: string;
  notes?: string;
  frequency?: string;
  actionTaken?: string;
  witnesses?: string;
  amount?: string;
  priorityOverride?: Priority;
  momenceContext?: MomenceContext;
  /** Agent-discovered facts that no fixed slot covers. */
  extraDetails?: Record<string, string>;
  /** Additional problems the same report surfaced, kept with the primary ticket. */
  secondaryIssues?: { title: string; category: string; subcategory: string; summary: string }[];
};

/**
 * Where a slot's value came from. `user` and `context` values are explicit
 * human intent and may never be overwritten by the model without a correction;
 * `agent` and `derived` values are machine judgement and can be revised freely.
 */
export type SlotSource = "user" | "context" | "agent" | "derived";

/** Slot ids the model may not silently overwrite once a human set them. */
export const HUMAN_LOCKED_SLOTS = new Set([
  "category", "subcategory", "studio", "raisedFor", "member", "trainer",
  "classInfo", "location", "systemAffected", "membershipRef", "occurredAt",
  "impact", "atRisk", "resolvedNow", "momenceSessionId", "momenceMemberId",
]);

export type IntakeState = {
  step: string;
  data: IntakeData;
  suggestions: { category: string; subcategory: string; confidence: number }[];
  showAllSubs: boolean;
  editingField: string | null;
  createdTicketId: number | null;
  inferred: string[];
  plan?: SlotId[];
  planIndex?: number;
  asked?: string[];
  /** Question ids the LLM agent has already put to this reporter. */
  agentAsked?: string[];
  /**
   * Every question actually put to the reporter, in words. Asking is a promise
   * that the answer matters — so an unanswered one is surfaced on the ticket
   * rather than forgotten when the draft is built.
   */
  agentAskLog?: { id: string; ask: string }[];
  pendingQuestionId?: string | null;
  /**
   * Consecutive reasoning-pass failures. A retry that keeps failing must not
   * loop the reporter forever on the same message, so the count decides when to
   * fall back to a draft built from what is already known.
   */
  agentFailures?: number;
  /** Whether the studio-scoped session lookup has already been run this session. */
  autoLookupDone?: boolean;
  /** Whether the member search has already been run this session. */
  memberLookupDone?: boolean;
  /** Momence lookups already run this session, kept so they are never repeated. */
  toolResults?: { tool: string; args?: Record<string, unknown>; result: string }[];
  /** Insight computed once at draft time and reused on approval. */
  insight?: AiInsight;
  /** Per-slot provenance — see SlotSource. */
  slotSources?: Record<string, SlotSource>;
  /** Compressed facts from the earlier part of a long conversation. */
  contextSummary?: string;
  /** How many transcript messages the summary already covers. */
  summaryCovered?: number;
  /** Draft-quality telemetry: how many edit rounds the reporter needed. */
  editCount?: number;
  outcome?: "approved";
  approvedAt?: string;
};

export function markSlotSource(
  s: IntakeState,
  key: string | string[],
  source: SlotSource,
): void {
  const keys = Array.isArray(key) ? key : [key];
  const next = { ...(s.slotSources ?? {}) };
  for (const k of keys) next[k] = source;
  s.slotSources = next;
}

export function slotSource(s: IntakeState, key: string): SlotSource | undefined {
  return s.slotSources?.[key];
}

export type EngineInput = { value?: string; text?: string; context?: ComposerContext; sessionId?: string };

export type EngineResult = {
  state: IntakeState;
  messages: ChatMessage[];
  createDraft?: TicketDraft;
};

let counter = 0;
function mid(): string {
  counter += 1;
  return `m${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}`;
}

export function assistantMessage(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return assistant(content, extra);
}

function assistant(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: mid(), role: "assistant", content, createdAt: new Date().toISOString(), kind: "text", ...extra };
}

export function emptyState(): IntakeState {
  return {
    step: "describe",
    data: {},
    suggestions: [],
    showAllSubs: false,
    editingField: null,
    createdTicketId: null,
    inferred: [],
    plan: [],
    planIndex: 0,
    asked: [],
    agentAsked: [],
    agentAskLog: [],
    pendingQuestionId: null,
    slotSources: {},
  };
}

/**
 * Translate a structured option value into the words a reporter effectively
 * said, so deterministic-path answers re-enter the transcript the agent reads.
 */
export function valueToWords(value: string, ctx: { studios: EngineContext["studios"] }): string {
  if (!value) return "";
  if (value.startsWith("ans:")) return value.slice(4);
  if (value.startsWith("studio:")) {
    if (value === "studio:none") return "This is not studio specific.";
    const st = ctx.studios.find((x) => x.id === Number(value.slice(7)));
    return st ? `The studio is ${st.name}, ${st.city}.` : "Picked the studio from the list.";
  }
  if (value.startsWith("session:")) {
    const [, id, ...rest] = value.split(":");
    const [name, at, teacher] = rest.join(":").split("|");
    return `The class was ${[name, at, teacher && `taught by ${teacher}`].filter(Boolean).join(", ")}.`;
  }
  if (value.startsWith("member:")) {
    const [, id, ...rest] = value.split(":");
    return `The member is ${rest.length ? rest.join(":") : value.slice(7)}.`;
  }
  if (value.startsWith("for:")) return `Raised for: ${value.slice(4)}.`;
  if (value.startsWith("class:")) return `The class was ${value.slice(6)}.`;
  if (value.startsWith("loc:")) return `It happened in the ${value.slice(4)}.`;
  if (value.startsWith("sys:")) return `The system affected is ${value.slice(4)}.`;
  if (value.startsWith("when:")) return `It happened ${value.slice(5).toLowerCase()}.`;
  if (value.startsWith("impact:")) return `Impact: ${value.slice(7)}.`;
  if (value === "risk:yes") return "Someone is at risk right now.";
  if (value === "risk:no") return "No immediate risk.";
  if (value.startsWith("freq:")) return `Frequency: ${value.slice(5)}.`;
  if (value.startsWith("membership:")) return `Membership: ${value.slice(11)}.`;
  if (value.startsWith("mem:")) return `Membership: ${value.slice(4)}.`;
  if (value.startsWith("trainer:")) return `The trainer was ${value.slice(8)}.`;
  if (value.startsWith("cat:")) return `File this under ${value.slice(4)}.`;
  if (value.startsWith("sub:")) return `The subcategory is ${value.slice(4)}.`;
  if (value === "skip") return "Skip that one.";
  if (value === "browse") return "Let me pick the category myself.";
  if (value === "unknown") return "The trainer's name is not known.";
  if (value === "showall") return "Show me all the options.";
  if (value === "confirm:yes") return "That classification is right.";
  if (value.startsWith("confirm:alt:")) return "Use a different classification.";
  if (value.startsWith("prio:")) return `Priority: ${value.slice(5)}.`;
  if (value === "edit" || value.startsWith("edit:")) return "I'd like to change something.";
  return "";
}

/* ------------------------------------------------------------------ */
/* Question flow                                                       */
/* ------------------------------------------------------------------ */

const ORDER = [
  "category", "subcategory", "detail", "studio", "risk", "raised_for", "member", "contact",
  "trainer", "class", "location", "system", "membership", "when", "impact", "notes", "review",
];

/** Subcategories where a physical location or device question makes no sense. */
const NON_PHYSICAL = /(charge|billing|invoice|refund|payment|password|login|notification|booking|listing|record|social|website|app |online|streaming|receipt|policy|pricing|discount|renewal|credits|membership)/i;

function followUps(category?: string, subcategory?: string): string[] {
  if (!category) return [];
  let list = metaFor(category).followUps;
  if (subcategory && NON_PHYSICAL.test(subcategory)) {
    list = list.filter((f) => f !== "location");
    if (/policy|pricing|discount|renewal|credits|membership|refund/i.test(subcategory)) {
      list = list.filter((f) => f !== "system");
    }
  }
  return list;
}

function applies(step: string, s: IntakeState): boolean {
  const d = s.data;
  switch (step) {
    case "category": return !d.category;
    case "subcategory": return !d.subcategory;
    case "detail": return !d.rawText;
    case "priority": return d.priorityOverride === undefined;
    default: {
      const slot = STEP_TO_SLOT[step];
      return slot ? !knownSlots(d).has(slot) : true;
    }
  }
}

function nextStep(s: IntakeState): string {
  if (s.editingField) return applies(s.editingField, s) ? s.editingField : "review";
  if (!s.data.category) return "category";
  if (!s.data.subcategory) return "subcategory";
  if (!s.data.rawText) return "detail";
  if (!s.plan || s.plan.length === 0) refreshPlan(s);
  const plan = s.plan ?? [];
  const known = knownSlots(s.data);
  for (const slot of plan) {
    if (!known.has(slot)) return SLOT_TO_STEP[slot];
  }
  return "review";
}

export function remainingCount(s: IntakeState): number {
  if (!s.plan) return 0;
  const known = knownSlots(s.data);
  return s.plan.filter((slot) => !known.has(slot)).length;
}

function categoryOptions(): ChatOption[] {
  return CATEGORIES.map((c) => ({
    label: `${CATEGORY_META[c].icon}  ${c}`,
    value: `cat:${c}`,
    hint: CATEGORY_META[c].blurb,
  }));
}

function subcategoryOptions(s: IntakeState): ChatOption[] {
  const category = s.data.category as string;
  const all = TAXONOMY[category] ?? [];
  const text = s.data.rawText ?? "";
  let ranked = all;
  if (text && !s.showAllSubs) {
    const scores = classify(text, 80).filter((c) => c.category === category);
    const order = new Map(scores.map((c, i) => [c.subcategory, i]));
    ranked = [...all].sort(
      (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || all.indexOf(a) - all.indexOf(b),
    );
  }
  const shown = s.showAllSubs ? ranked : ranked.slice(0, 8);
  const options: ChatOption[] = shown.map((sub) => ({ label: sub, value: `sub:${sub}` }));
  if (!s.showAllSubs && all.length > shown.length) {
    options.push({ label: `Show all ${all.length} options`, value: "showall", tone: "ghost" });
  }
  return options;
}

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
/* Dynamic plan driven by the AI slot planner                          */
/* ------------------------------------------------------------------ */

const SLOT_TO_STEP: Record<SlotId, string> = {
  studio: "studio",
  raisedFor: "raised_for",
  member: "member",
  memberContact: "contact",
  trainer: "trainer",
  classInfo: "class",
  location: "location",
  systemAffected: "system",
  membershipRef: "membership",
  occurredAt: "when",
  impact: "impact",
  atRisk: "risk",
  frequency: "frequency",
  actionTaken: "action_taken",
  witnesses: "witnesses",
  amount: "amount",
  notes: "notes",
};
const STEP_TO_SLOT: Record<string, SlotId> = Object.fromEntries(
  Object.entries(SLOT_TO_STEP).map(([k, v]) => [v, k as SlotId]),
) as Record<string, SlotId>;

function knownSlots(d: IntakeData): Set<SlotId> {
  const set = new Set<SlotId>();
  if (d.studioName !== undefined) set.add("studio");
  if (d.raisedFor) set.add("raisedFor");
  if (d.memberName !== undefined) set.add("member");
  if (d.memberContact !== undefined || d.momenceMemberId) set.add("memberContact");
  if (d.trainerName !== undefined) set.add("trainer");
  if (d.classInfo !== undefined) set.add("classInfo");
  if (d.location !== undefined) set.add("location");
  if (d.systemAffected !== undefined) set.add("systemAffected");
  if (d.membershipRef !== undefined) set.add("membershipRef");
  if (d.occurredAt !== undefined) set.add("occurredAt");
  if (d.impact !== undefined) set.add("impact");
  if (d.atRisk !== undefined) set.add("atRisk");
  if (d.frequency !== undefined) set.add("frequency");
  if (d.actionTaken !== undefined) set.add("actionTaken");
  if (d.witnesses !== undefined) set.add("witnesses");
  if (d.amount !== undefined) set.add("amount");
  if (d.notes !== undefined) set.add("notes");
  return set;
}

/** Recompute the remaining question plan from what is still unknown. */
function refreshPlan(s: IntakeState): void {
  if (!s.data.category || !s.data.subcategory) return;
  s.plan = planSlots({
    category: s.data.category,
    subcategory: s.data.subcategory,
    text: `${s.data.rawText ?? ""} ${s.data.notes ?? ""}`,
    known: knownSlots(s.data),
  });
  s.planIndex = 0;
}

function dynamicQuestion(slot: SlotId, s: IntakeState): Question {
  const q = buildQuestion(slot, {
    category: s.data.category,
    subcategory: s.data.subcategory ?? "issue",
    studio: s.data.studioName,
    member: s.data.memberName,
    trainer: s.data.trainerName,
  });
  const options: ChatOption[] = [...(q.options ?? [])];
  if (q.skipLabel) options.push({ label: q.skipLabel, value: "skip", tone: "ghost" });

  const why = WHY[slot];
  const tip = coachTip(slot, s.data);
  const helper = [q.helper, tip].filter(Boolean).join(" ") || undefined;
  const prompt = why ? `${q.prompt} — ${why}.` : q.prompt;

  return {
    prompt: helper ? `${prompt}\n_${helper}_` : prompt,
    options: options.length ? options : undefined,
    allowFreeText: q.allowFreeText,
    placeholder: q.placeholder,
    picker: q.picker,
  };
}

type Question = {
  prompt: string;
  options?: ChatOption[];
  allowFreeText?: boolean;
  placeholder?: string;
  picker?: "member" | "session" | "trainer" | "studio" | "membership";
};

function question(step: string, s: IntakeState, ctx: EngineContext): Question {
  const d = s.data;
  const slot = STEP_TO_SLOT[step];
  if (slot && step !== "studio") {
    const q = dynamicQuestion(slot, s);
    if (step === "member") q.options = [...(q.options ?? [])];
    return q;
  }
  switch (step) {
    case "category":
      return { prompt: "Which area does this belong to?", options: categoryOptions() };
    case "subcategory":
      return {
        prompt: `**${d.category}** — which of these fits best?`,
        options: subcategoryOptions(s),
        allowFreeText: true,
        placeholder: "…or describe it in your own words",
      };
    case "detail":
      return {
        prompt: "Tell me what happened in a line or two, so the owner has full context.",
        allowFreeText: true,
        placeholder: "e.g. AC in Studio 1 stopped cooling during the 7am class",
      };
    case "studio":
      return { prompt: "Which studio is this about?", options: studioOptions(ctx) };
    case "raised_for":
      return {
        prompt: "Who is this being raised for?",
        options: [
          { label: "A member reported it", value: "for:On behalf of a member" },
          { label: "I noticed it myself", value: "for:Noticed by staff" },
          { label: "Multiple members raised it", value: "for:Multiple members" },
          { label: "Staff / trainer concern", value: "for:Staff or trainer concern" },
        ],
      };
    case "member":
      return {
        prompt: "Which member is this for? Search Momence or type a name.",
        options: [{ label: "Keep it anonymous", value: "skip", tone: "ghost" }],
        allowFreeText: true,
        placeholder: "Member name",
      };
    case "contact":
      return {
        prompt: `Any contact detail for ${d.memberName} so the owner can follow up?`,
        options: [{ label: "Skip — not needed", value: "skip", tone: "ghost" }],
        allowFreeText: true,
        placeholder: "Phone or email",
      };
    case "trainer":
      return {
        prompt: "Which trainer was involved?",
        options: [
          { label: "Not trainer specific", value: "skip", tone: "ghost" },
          { label: "Don't know the name", value: "unknown", tone: "ghost" },
        ],
        allowFreeText: true,
        placeholder: "Trainer name",
      };
    case "class":
      return {
        prompt: "Which class or format was it?",
        options: CLASS_FORMATS.map((c) => ({ label: c, value: `class:${c}` })),
        allowFreeText: true,
        placeholder: "e.g. 7:00 AM Barre 57",
      };
    case "location":
      return {
        prompt: "Where in the studio is this?",
        options: LOCATIONS.map((l) => ({ label: l, value: `loc:${l}` })),
        allowFreeText: true,
        placeholder: "Describe the spot",
      };
    case "system":
      return {
        prompt: "Which system or device is affected?",
        options: SYSTEMS.map((sys) => ({ label: sys, value: `sys:${sys}` })),
        allowFreeText: true,
        placeholder: "Name the system",
      };
    case "membership":
      return {
        prompt: "Which membership or package does this relate to?",
        options: MEMBERSHIPS.map((m) => ({ label: m, value: `mem:${m}` })),
        allowFreeText: true,
        placeholder: "e.g. 20-class pack bought in March",
      };
    case "risk":
      return {
        prompt: "Is anyone at risk, or is this still happening right now?",
        options: [
          { label: "Yes — needs immediate action", value: "risk:yes", tone: "danger" },
          { label: "No immediate risk", value: "risk:no" },
        ],
      };
    case "when":
      return {
        prompt: "When did this happen?",
        options: [
          { label: "Just now", value: "when:Just now" },
          { label: "Earlier today", value: "when:Earlier today" },
          { label: "Yesterday", value: "when:Yesterday" },
          { label: "Earlier this week", value: "when:Earlier this week" },
          { label: "Ongoing / recurring", value: "when:Ongoing / recurring" },
        ],
      };
    case "impact":
      return {
        prompt: "How wide is the impact? This sets priority and SLA.",
        options: IMPACT_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
      };
    case "notes":
      return {
        prompt: "Anything else to add — context or actions already taken?",
        options: [{ label: "Nothing else — show me the draft", value: "skip", tone: "ghost" }],
        allowFreeText: true,
        placeholder: "Additional notes",
      };
    case "priority":
      return {
        prompt: "Set the priority manually:",
        options: (["Critical", "High", "Medium", "Low"] as Priority[]).map((p) => ({
          label: p,
          value: `prio:${p}`,
          tone: p === "Critical" ? "danger" : "default",
        })),
      };
    default:
      return { prompt: "Here's the draft." };
  }
}

/* ------------------------------------------------------------------ */
/* Draft assembly                                                      */
/* ------------------------------------------------------------------ */

export function buildDraft(s: IntakeState, ctx: EngineContext, insight?: AiInsight): TicketDraft {
  const d = s.data;
  const category = insight?.category ?? d.category ?? "Miscellaneous";
  const subcategory = insight?.subcategory ?? d.subcategory ?? (TAXONOMY[category]?.[0] ?? "Miscellaneous");
  const raw = [d.rawText ?? "", d.notes ?? ""].filter(Boolean).join(" ");
  const studioLabel = d.studioName ?? "Not studio specific";

  const ai =
    insight ??
    s.insight ??
    localEnrich({
      text: raw,
      category,
      subcategory,
      impact: d.impact,
      atRisk: d.atRisk,
      resolvedNow: d.resolvedNow,
      studioName: studioLabel,
      memberName: d.memberName,
      trainerName: d.trainerName,
      classInfo: d.classInfo,
    });

  const priority = d.priorityOverride ?? ai.priority;

  const detailLines: string[] = [];
  if (d.rawText) detailLines.push(d.rawText.trim());
  if (d.actionTaken && d.actionTaken !== "Nothing yet") {
    detailLines.push(`Action already taken: ${d.actionTaken.trim()}`);
  }
  if (d.notes) detailLines.push(`Additional notes: ${d.notes.trim()}`);
  if (d.secondaryIssues?.length) {
    detailLines.push(
      ["Also surfaced by this report:", ...d.secondaryIssues.map((i) => `• ${i.title} — ${i.summary}`)].join(
        "\n",
      ),
    );
  }

  const details: Record<string, string> = {};
  if (d.trainerName && d.trainerName !== "Not identified") details["Trainer"] = d.trainerName;
  if (d.classInfo) details["Class / format"] = d.classInfo;
  if (d.classAt) details["Class date & time"] = d.classAt;
  if (d.location) details["Location"] = d.location;
  if (d.systemAffected) details["System affected"] = d.systemAffected;
  if (d.membershipRef) details["Membership"] = d.membershipRef;
  if (d.occurredAt) details["When"] = d.occurredAt;
  if (d.impact) details["Impact"] = IMPACT_LABEL[d.impact] ?? d.impact;
  if (d.atRisk !== undefined) details["Immediate risk"] = d.atRisk ? "Yes — escalated" : "No";
  if (d.resolvedNow !== undefined) {
    details["Current state"] = d.resolvedNow ? "Resolved / fixed at time of report" : "Still happening at time of report";
  }
  if (d.memberContact) details["Member contact"] = d.memberContact;
  if (d.momenceMemberId) details["Momence member ID"] = String(d.momenceMemberId);
  if (d.momenceSessionIds?.length) {
    details["Momence session IDs"] = d.momenceSessionIds.join(", ");
  }
  if (d.affectedMembers) details["Members affected"] = d.affectedMembers;
  if (d.frequency) details["Frequency"] = d.frequency;
  if (d.actionTaken) details["Action already taken"] = d.actionTaken;
  if (d.witnesses) details["Witnesses"] = d.witnesses;
  if (d.amount) details["Amount in dispute"] = d.amount;
  for (const [label, value] of Object.entries(d.extraDetails ?? {})) {
    if (value) details[label] = value;
  }

  return {
    category,
    subcategory,
    ownerHint: suggestOwner(category, subcategory),
    title: ai.title.slice(0, 140),
    summary: ai.summary,
    description: detailLines.join("\n\n"),
    priority,
    studioId: d.studioId ?? null,
    studioName: studioLabel,
    reportedBy: ctx.reporter.name,
    reportedByRole: ctx.reporter.role,
    raisedFor: d.raisedFor ?? "Noticed by staff",
    memberName: d.memberName,
    memberContact: d.memberContact,
    momenceMemberId: d.momenceMemberId,
    momenceSessionId: d.momenceSessionId,
    membershipRef: d.membershipRef,
    trainerName: d.trainerName,
    classInfo: d.classInfo,
    classAt: d.classAt,
    location: d.location,
    systemAffected: d.systemAffected,
    occurredAt: d.occurredAt,
    impact: d.impact ? (IMPACT_LABEL[d.impact] ?? d.impact) : undefined,
    sentiment: ai.sentiment,
    emotion: ai.emotion,
    urgencyScore: ai.urgencyScore,
    churnRisk: ai.churnRisk,
    effort: ai.effort,
    rootCause: ai.rootCause,
    suggestedAction: ai.suggestedAction,
    aiConfidence: ai.confidence,
    aiEngine: ai.engine,
    severity: ai.severity,
    slaRespondHours: ai.slaRespondHours,
    slaResolveHours: ai.slaResolveHours,
    slaPolicy: ai.slaPolicy,
    slaReason: ai.slaReason,
    department: CATEGORY_DEPARTMENT[category] ?? "Operations",
    tags: ai.tags,
    details,
    momenceContext: d.momenceContext,
    source: "AI Assistant",
    secondaryIssues: d.secondaryIssues,
    priorityReason: d.priorityOverride ? "Set manually during intake" : ai.priorityReason,
  };
}

export function reviewMessage(s: IntakeState, ctx: EngineContext, insight?: AiInsight): ChatMessage {
  const draft = buildDraft(s, ctx, insight);
  const first = ctx.reporter.name.split(" ")[0] || "there";
  return assistant(
    `Here's your draft, ${first} — my full read on it. Give it a look, and approve when you're happy and I'll route it straight to the right owner.`,
    {
      kind: "draft",
      draft,
      options: [
        { label: "Looks good — raise it", value: "approve", tone: "primary" },
        { label: "Change something", value: "edit" },
        { label: "Start over", value: "restart", tone: "ghost" },
      ],
    },
  );
}

function editMenu(s: IntakeState): ChatMessage {
  const d = s.data;
  const f = followUps(d.category, d.subcategory);
  const opts: ChatOption[] = [
    { label: "Category / subcategory", value: "edit:category" },
    { label: "Studio", value: "edit:studio" },
    { label: "Description", value: "edit:detail" },
    { label: "Raised for", value: "edit:raised_for" },
  ];
  if (d.raisedFor === "On behalf of a member") opts.push({ label: "Member details", value: "edit:member" });
  if (f.includes("trainer")) opts.push({ label: "Trainer", value: "edit:trainer" });
  if (f.includes("class")) opts.push({ label: "Class / format", value: "edit:class" });
  if (f.includes("location")) opts.push({ label: "Location", value: "edit:location" });
  if (f.includes("system")) opts.push({ label: "System affected", value: "edit:system" });
  if (f.includes("membership")) opts.push({ label: "Membership", value: "edit:membership" });
  opts.push(
    { label: "When it happened", value: "edit:when" },
    { label: "Impact", value: "edit:impact" },
    { label: "Priority", value: "edit:priority" },
    { label: "Notes", value: "edit:notes" },
    { label: "Back to draft", value: "edit:cancel", tone: "ghost" },
  );
  return assistant("What would you like to change?", { options: opts });
}

function ask(step: string, s: IntakeState, ctx: EngineContext, prefix?: string, inferred?: string[]): ChatMessage[] {
  if (step === "review") {
    const msgs: ChatMessage[] = [];
    if (prefix) msgs.push(assistant(prefix, inferred?.length ? { inferred } : {}));
    msgs.push(reviewMessage(s, ctx));
    return msgs;
  }
  const q = question(step, s, ctx);
  const planned = (s.plan?.length ?? 0) > 0;
  const note = planned ? progressNote(remainingCount(s)) : null;
  const lead = [prefix, note && note !== prefix ? note : null].filter(Boolean).join(" ");
  const content = lead ? `${lead}\n\n${q.prompt}` : q.prompt;
  return [
    assistant(content, {
      options: q.options,
      allowFreeText: q.allowFreeText ?? false,
      placeholder: q.placeholder,
      picker: q.picker,
      remaining: remainingCount(s),
      ...(inferred?.length ? { inferred } : {}),
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* Session start                                                       */
/* ------------------------------------------------------------------ */

export function startSession(ctx: EngineContext): EngineResult {
  const state = emptyState();
  const first = ctx.reporter.name.split(" ")[0] || "there";
  const greeting = assistant(
    `${timeGreeting()}, ${first} — Iris here. 👋\n\nTell me what happened in your own words, like you'd tell a colleague — where it was, which class or member it involves, and anything you've already done about it. I'll read the whole thing, pull the details from Momence, and only ask about what's genuinely missing.`,
    {
      allowFreeText: true,
      placeholder: "e.g. The AC in Studio 1 wasn't cooling during the 7am class today",
    },
  );
  return { state, messages: [greeting] };
}

/* ------------------------------------------------------------------ */
/* Answer handling                                                     */
/* ------------------------------------------------------------------ */

function applyAnswer(
  step: string,
  input: EngineInput,
  s: IntakeState,
  ctx: EngineContext,
): { ok: boolean; prefix?: string; retry?: string } {
  const value = input.value ?? "";
  const text = (input.text ?? "").trim();
  const d = s.data;
  const takeText = (): string | null => (text.length > 0 ? text : null);

  // Universal graceful skip — no question can ever trap the user in a loop.
  if (value === "skip" && !text) {
    const defaults: Record<string, () => void> = {
      raised_for: () => { d.raisedFor = "Noticed by staff"; },
      when: () => { d.occurredAt = "Not specified"; },
      impact: () => { d.impact = "single"; },
      risk: () => { d.atRisk = false; },
      frequency: () => { d.frequency = "Not specified"; },
      location: () => { d.location = "Not specified"; },
      system: () => { d.systemAffected = "Not specified"; },
      membership: () => { d.membershipRef = "Not applicable"; },
      class: () => { d.classInfo = "Not class specific"; },
    };
    const fn = defaults[step];
    if (fn) {
      fn();
      return { ok: true };
    }
  }

  switch (step) {
    case "category": {
      if (value.startsWith("cat:")) {
        d.category = value.slice(4);
        s.showAllSubs = false;
        return { ok: true };
      }
      const t = takeText();
      if (t) {
        const match = CATEGORIES.find((c) => c.toLowerCase() === t.toLowerCase());
        if (match) {
          d.category = match;
          return { ok: true };
        }
        const guess = classify(t, 1)[0];
        if (guess) {
          d.category = guess.category;
          d.subcategory = guess.subcategory;
          if (!d.rawText) d.rawText = t;
          inferFromText(t, s, ctx);
          return { ok: true, prefix: `Filed under **${guess.category} › ${guess.subcategory}**.` };
        }
      }
      return { ok: false, retry: "Please pick one of the categories below." };
    }
    case "subcategory": {
      if (value === "showall") {
        s.showAllSubs = true;
        return { ok: false, retry: "" };
      }
      if (value.startsWith("sub:")) {
        d.subcategory = value.slice(4);
        return { ok: true };
      }
      const t = takeText();
      if (t && d.category) {
        const list = TAXONOMY[d.category] ?? [];
        const exact = list.find((x) => x.toLowerCase() === t.toLowerCase());
        if (exact) {
          d.subcategory = exact;
          return { ok: true };
        }
        const guess = classify(t, 30).find((g) => g.category === d.category);
        if (!d.rawText) d.rawText = t;
        inferFromText(t, s, ctx);
        d.subcategory = guess?.subcategory ?? list[list.length - 1] ?? "Miscellaneous";
        return { ok: true, prefix: `Closest match: **${d.subcategory}**.` };
      }
      return { ok: false, retry: "Pick the closest subcategory below." };
    }
    case "detail": {
      const t = takeText();
      if (!t) return { ok: false, retry: "A one-line description helps the owner act quickly." };
      d.rawText = t;
      const found = inferFromText(t, s, ctx);
      s.inferred = found;
      return { ok: true, prefix: found.length ? `Noted — I also picked up: ${found.join(", ")}.` : undefined };
    }
    case "studio": {
      if (value === "studio:none" || value === "skip") {
        d.studioId = null;
        d.studioName = "Not studio specific";
        return { ok: true };
      }
      if (value.startsWith("studio:")) {
        const studio = ctx.studios.find((st) => st.id === Number(value.split(":")[1]));
        if (studio) {
          d.studioId = studio.id;
          d.studioName = `${studio.name}, ${studio.city}`;
          return { ok: true };
        }
      }
      const t = takeText();
      if (t) {
        const found = extractStudio(t, ctx.studios);
        if (found) {
          const studio = ctx.studios.find((st) => st.id === found.id)!;
          d.studioId = studio.id;
          d.studioName = `${studio.name}, ${studio.city}`;
          return { ok: true };
        }
      }
      return { ok: false, retry: "Tap the studio this relates to." };
    }
    case "raised_for": {
      if (value.startsWith("for:")) {
        d.raisedFor = value.slice(4);
        return { ok: true };
      }
      return { ok: false, retry: "Choose one of the options below." };
    }
    case "member": {
      if (value === "skip") {
        d.memberName = "Anonymous member";
        return { ok: true };
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
        d.raisedFor = d.raisedFor ?? "On behalf of a member";
        return { ok: true };
      }
      const t = takeText();
      if (!t) return { ok: false, retry: "Type the member's name, or keep it anonymous." };
      d.memberName = t;
      return { ok: true };
    }
    case "contact": {
      d.memberContact = value === "skip" ? "" : (takeText() ?? "");
      return { ok: true };
    }
    case "trainer": {
      if (value.startsWith("trainer:")) {
        d.trainerName = value.slice(8);
        return { ok: true };
      }
      if (value === "skip") {
        d.trainerName = "";
        return { ok: true };
      }
      if (value === "unknown") {
        d.trainerName = "Not identified";
        return { ok: true };
      }
      const t = takeText();
      if (!t) return { ok: false, retry: "Type the trainer's name or tap an option." };
      d.trainerName = t;
      return { ok: true };
    }
    case "class": {
      if (value.startsWith("session:")) {
        const [, id, ...rest] = value.split(":");
        d.momenceSessionId = Number(id);
        const payload = rest.join(":");
        const [name, at, teacher] = payload.split("|");
        d.classInfo = name;
        if (at) d.classAt = at;
        if (teacher && !d.trainerName) d.trainerName = teacher;
        return { ok: true };
      }
      if (value.startsWith("class:")) {
        d.classInfo = value.slice(6);
        return { ok: true };
      }
      const t = takeText();
      if (!t) return { ok: false, retry: "Pick the class format or type it." };
      d.classInfo = t;
      return { ok: true };
    }
    case "location": {
      if (value.startsWith("loc:")) {
        d.location = value.slice(4);
        return { ok: true };
      }
      const t = takeText();
      if (!t) return { ok: false, retry: "Where exactly is this?" };
      d.location = t;
      return { ok: true };
    }
    case "system": {
      if (value.startsWith("sys:")) {
        d.systemAffected = value.slice(4);
        return { ok: true };
      }
      const t = takeText();
      if (!t) return { ok: false, retry: "Which system is affected?" };
      d.systemAffected = t;
      return { ok: true };
    }
    case "membership": {
      if (value.startsWith("membership:")) {
        d.membershipRef = value.slice(11);
        return { ok: true };
      }
      if (value.startsWith("mem:")) {
        d.membershipRef = value.slice(4);
        return { ok: true };
      }
      const t = takeText();
      if (!t) return { ok: false, retry: "Pick the membership type or type it." };
      d.membershipRef = t;
      return { ok: true };
    }
    case "risk": {
      if (value === "risk:yes") {
        d.atRisk = true;
        return { ok: true, prefix: "Understood — marking this **Critical** and flagging Management." };
      }
      if (value === "risk:no") {
        d.atRisk = false;
        return { ok: true };
      }
      const t = (takeText() ?? "").toLowerCase();
      if (/^(yes|y|yeah)/.test(t)) {
        d.atRisk = true;
        return { ok: true };
      }
      if (/^(no|n|nope)/.test(t)) {
        d.atRisk = false;
        return { ok: true };
      }
      return { ok: false, retry: "Please confirm — is anyone at risk right now?" };
    }
    case "when": {
      if (value.startsWith("when:")) {
        d.occurredAt = value.slice(5);
        return { ok: true };
      }
      const t = takeText();
      if (!t) return { ok: false, retry: "When did this happen?" };
      d.occurredAt = t;
      return { ok: true };
    }
    case "impact": {
      const found = IMPACT_OPTIONS.find((o) => o.value === value);
      if (found) {
        d.impact = found.key;
        return { ok: true };
      }
      const t = takeText();
      if (t) {
        d.impact = "single";
        d.notes = d.notes ? `${d.notes} ${t}` : t;
        return { ok: true };
      }
      return { ok: false, retry: "Pick the closest impact level." };
    }
    case "notes": {
      d.notes = value === "skip" ? "" : (takeText() ?? "");
      return { ok: true };
    }
    case "frequency": {
      if (value.startsWith("freq:")) {
        d.frequency = value.slice(5);
        return { ok: true };
      }
      const t = takeText();
      if (!t) return { ok: false, retry: "Pick how often this happens." };
      d.frequency = t;
      return { ok: true };
    }
    case "action_taken": {
      d.actionTaken = value === "skip" ? "Nothing yet" : (takeText() ?? "");
      return { ok: true };
    }
    case "witnesses": {
      d.witnesses = value === "skip" ? "None recorded" : (takeText() ?? "");
      return { ok: true };
    }
    case "amount": {
      d.amount = value === "skip" ? "" : (takeText() ?? "");
      return { ok: true };
    }
    case "priority": {
      if (value.startsWith("prio:")) {
        d.priorityOverride = value.slice(5) as Priority;
        return { ok: true };
      }
      return { ok: false, retry: "Pick a priority level." };
    }
    default:
      return { ok: true };
  }
}

export function handleInput(state: IntakeState, input: EngineInput, ctx: EngineContext): EngineResult {
  const s: IntakeState = { ...state, data: { ...state.data }, suggestions: [...state.suggestions] };
  const value = input.value ?? "";
  const text = (input.text ?? "").trim();

  if (value === "restart") {
    const fresh = startSession(ctx);
    return { state: fresh.state, messages: fresh.messages };
  }

  if (value === "undo") {
    const order: (keyof IntakeData)[] = [
      "notes", "amount", "witnesses", "actionTaken", "frequency", "impact", "occurredAt",
      "membershipRef", "systemAffected", "location", "classInfo", "trainerName",
      "memberContact", "memberName", "atRisk", "raisedFor", "studioName",
    ];
    const last = order.find((k) => s.data[k] !== undefined);
    if (!last) {
      return { state: s, messages: [assistant("Nothing to undo yet.")] };
    }
    delete s.data[last];
    if (last === "studioName") delete s.data.studioId;
    if (last === "memberName") delete s.data.momenceMemberId;
    if (last === "classInfo") {
      delete s.data.momenceSessionId;
      delete s.data.classAt;
    }
    s.editingField = null;
    refreshPlan(s);
    const step = nextStep(s);
    s.step = step;
    return { state: s, messages: ask(step, s, ctx, "Undone — let's redo that one.") };
  }

  /* ---------- opening turn ---------- */
  if (s.step === "describe") {
    const ctxFound = input.context ? applyComposerContext(input.context, s) : [];

    if (value === "browse") {
      s.step = "category";
      return { state: s, messages: ask("category", s, ctx) };
    }
    if (value.startsWith("cat:")) {
      s.data.category = value.slice(4);
      s.showAllSubs = false;
      s.step = "subcategory";
      return {
        state: s,
        messages: ask("subcategory", s, ctx, `**${s.data.category}** — good call. Let's narrow it down.`),
      };
    }
    if (!text) {
      const step = nextStep(s);
      s.step = step;
      return { state: s, messages: ask(step, s, ctx, "Let's start with the area.") };
    }

    s.data.rawText = text;
    const textFound = inferFromText(text, s, ctx);
    const inferred = [...ctxFound, ...textFound];
    s.inferred = inferred;

    if (!s.data.category) {
      const results = classify(text, 4);
      s.suggestions = results.map((r) => ({
        category: r.category,
        subcategory: r.subcategory,
        confidence: r.confidence,
      }));
      if (results.length === 0) {
        s.step = "category";
        return {
          state: s,
          messages: ask("category", s, ctx, "Thanks — I couldn't classify that confidently, so let's pick the area together.", inferred),
        };
      }
      const best = results[0];
      const preview = localEnrich({
        text,
        category: best.category,
        subcategory: best.subcategory,
        impact: s.data.impact,
        atRisk: s.data.atRisk,
        resolvedNow: s.data.resolvedNow,
        studioName: s.data.studioName,
        memberName: s.data.memberName,
        trainerName: s.data.trainerName,
        classInfo: s.data.classInfo,
      });
      const reaction = reactTo(text, preview.sentiment, best.category);
      const analysis = [
        { label: "Category", value: `${CATEGORY_META[best.category].icon} ${best.category}` },
        { label: "Subcategory", value: best.subcategory },
        { label: "Sentiment", value: `${preview.sentiment} · ${preview.emotion}` },
        { label: "Priority", value: preview.priority, tone: preview.priority.toLowerCase() },
        { label: "Urgency", value: `${preview.urgencyScore}/100` },
        { label: "Routing", value: CATEGORY_DEPARTMENT[best.category] ?? "Operations" },
      ];
      s.step = "confirm";
      return {
        state: s,
        messages: [
          assistant(reaction, { analysis, ...(inferred.length ? { inferred } : {}) }),
          assistant(
            `I'd file this under **${best.category} › ${best.subcategory}**. Sound right?`,
            {
            options: [
              { label: "Yes, that's right", value: "confirm:yes", tone: "primary" },
              ...results.slice(1, 3).map((a, i) => ({
                label: a.subcategory,
                value: `confirm:alt:${i}`,
                hint: a.category,
              })),
              { label: "Let me browse", value: "confirm:browse", tone: "ghost" as const },
            ],
          },
          ),
        ],
      };
    }

    const step = nextStep(s);
    s.step = step;
    return {
      state: s,
      messages: ask(step, s, ctx, inferred.length ? `Captured: ${inferred.join(", ")}.` : undefined, inferred),
    };
  }

  /* ---------- confirmation ---------- */
  if (s.step === "confirm") {
    if (value === "confirm:yes") {
      const best = s.suggestions[0];
      s.data.category = best.category;
      s.data.subcategory = best.subcategory;
    } else if (value.startsWith("confirm:alt:")) {
      const alt = s.suggestions[Number(value.split(":")[2]) + 1];
      if (alt) {
        s.data.category = alt.category;
        s.data.subcategory = alt.subcategory;
      }
    } else if (value === "confirm:browse") {
      s.step = "category";
      s.showAllSubs = false;
      return { state: s, messages: ask("category", s, ctx) };
    } else if (text) {
      const guess = classify(text, 1)[0];
      if (guess) {
        s.data.category = guess.category;
        s.data.subcategory = guess.subcategory;
        s.data.rawText = `${s.data.rawText ?? ""} ${text}`.trim();
      } else {
        s.step = "category";
        return { state: s, messages: ask("category", s, ctx, "Let's pick the area manually.") };
      }
    } else {
      return { state: s, messages: [assistant("Just confirm the classification below and we'll continue.")] };
    }
    refreshPlan(s);
    const step = nextStep(s);
    s.step = step;
    const remaining = remainingCount(s);
    const intro = issueIntro(s.data.category ?? "", s.data.subcategory ?? "");
    const tail =
      remaining === 0
        ? "You've already told me everything I need."
        : remaining <= 2
          ? "Nearly done."
          : `${remaining} quick things and we're finished.`;
    const prefix = intro ? `${intro} ${tail}` : `Locked in — ${tail}`;
    return { state: s, messages: ask(step, s, ctx, prefix) };
  }

  /* ---------- review ---------- */
  if (s.step === "review") {
    if (value === "approve") {
      return { state: s, messages: [], createDraft: buildDraft(s, ctx) };
    }
    if (value === "edit") {
      s.step = "edit_menu";
      return { state: s, messages: [editMenu(s)] };
    }
    if (text) {
      s.data.notes = s.data.notes ? `${s.data.notes} ${text}` : text;
      return { state: s, messages: [assistant("Added to the notes."), reviewMessage(s, ctx)] };
    }
    return { state: s, messages: [reviewMessage(s, ctx)] };
  }

  if (s.step === "edit_menu") {
    if (value === "edit:cancel") {
      s.step = "review";
      return { state: s, messages: [reviewMessage(s, ctx)] };
    }
    if (value.startsWith("edit:")) {
      const field = value.slice(5);
      const d = s.data;
      const clear: Record<string, () => void> = {
        category: () => {
          d.category = undefined;
          d.subcategory = undefined;
          s.showAllSubs = false;
        },
        studio: () => {
          d.studioId = undefined;
          d.studioName = undefined;
        },
        detail: () => { d.rawText = undefined; },
        raised_for: () => { d.raisedFor = undefined; },
        member: () => {
          d.memberName = undefined;
          d.memberContact = undefined;
          d.momenceMemberId = undefined;
        },
        trainer: () => { d.trainerName = undefined; },
        class: () => { d.classInfo = undefined; },
        location: () => { d.location = undefined; },
        system: () => { d.systemAffected = undefined; },
        membership: () => { d.membershipRef = undefined; },
        when: () => { d.occurredAt = undefined; },
        impact: () => { d.impact = undefined; },
        notes: () => { d.notes = undefined; },
        frequency: () => { d.frequency = undefined; },
        action_taken: () => { d.actionTaken = undefined; },
        witnesses: () => { d.witnesses = undefined; },
        amount: () => { d.amount = undefined; },
        priority: () => { d.priorityOverride = undefined; },
      };
      clear[field]?.();
      // The cached read no longer describes this ticket — score it again once
      // the new answer is in. (Merely viewing the draft must not do this.)
      s.insight = undefined;
      s.editingField = field;
      const step = nextStep(s);
      s.step = step;
      return { state: s, messages: ask(step, s, ctx) };
    }
    return { state: s, messages: [editMenu(s)] };
  }

  if (s.step === "created") {
    if (value === "new") return startSession(ctx);
    return {
      state: s,
      messages: [
        assistant("This ticket is already raised. Start a new one below.", {
          options: [{ label: "Raise another ticket", value: "new", tone: "primary" }],
        }),
      ],
    };
  }

  /* ---------- standard question ---------- */
  const previousStep = s.step;
  const result = applyAnswer(s.step, input, s, ctx);
  if (!result.ok) {
    const q = question(s.step, s, ctx);
    const nudge = result.retry
      ? pickNudge(result.retry, s.step)
      : undefined;
    return {
      state: s,
      messages: [
        assistant(nudge ? `${nudge}\n\n${q.prompt}` : q.prompt, {
          options: q.options,
          allowFreeText: q.allowFreeText ?? false,
          placeholder: q.placeholder,
          picker: q.picker,
          remaining: remainingCount(s),
        }),
      ],
    };
  }

  // Answers change what is still worth asking — never walk a stale plan.
  refreshPlan(s);

  if (s.editingField) {
    if (s.editingField === "category" && !s.data.subcategory) {
      s.step = "subcategory";
      return { state: s, messages: ask("subcategory", s, ctx) };
    }
    s.editingField = null;
    s.step = "review";
    return { state: s, messages: [assistant("Updated."), reviewMessage(s, ctx)] };
  }

  const answeredSlot = STEP_TO_SLOT[previousStep];
  const acknowledgement =
    result.prefix ??
    (answeredSlot ? ack(answeredSlot, slotValue(answeredSlot, s.data)) : undefined);

  const step = nextStep(s);
  s.step = step;
  return { state: s, messages: ask(step, s, ctx, acknowledgement) };
}

const NUDGES = [
  "Sorry, I need one of the options below.",
  "I didn't quite catch that one.",
  "Let's try that again.",
];
let nudgeIndex = 0;
function pickNudge(fallback: string, step: string): string {
  if (step === "detail" || step === "subcategory") return fallback;
  nudgeIndex = (nudgeIndex + 1) % NUDGES.length;
  return NUDGES[nudgeIndex];
}

function slotValue(slot: SlotId, d: IntakeData): string | undefined {
  const map: Partial<Record<SlotId, unknown>> = {
    studio: d.studioName,
    member: d.memberName,
    trainer: d.trainerName,
    classInfo: d.classInfo,
    impact: d.impact,
    atRisk: d.atRisk,
    occurredAt: d.occurredAt,
    membershipRef: d.membershipRef,
  };
  const v = map[slot];
  return v === undefined ? undefined : String(v);
}

export function createdMessage(
  ticket: {
    id: number;
    ticketNumber: string;
    assigneeName: string | null;
    assigneeTeam: string | null;
    assigneeEmail: string | null;
    assignmentReason: string | null;
    slaDueAt: Date | null;
    priority: string;
  },
  linked: { ticketNumber: string; title: string; assigneeName: string | null }[] = [],
): ChatMessage {
  const hours = ticket.slaDueAt
    ? Math.max(1, Math.round((ticket.slaDueAt.getTime() - Date.now()) / 3600000))
    : 24;
  const linkedNote = linked.length
    ? `\n\nThis report also covered ${linked.length === 1 ? "one other issue" : `${linked.length} other issues`}, so I raised ${linked.length === 1 ? "a linked ticket" : "linked tickets"} that route separately:\n${linked
        .map((l) => `• **${l.ticketNumber}** — ${l.title}${l.assigneeName ? ` (${l.assigneeName})` : ""}`)
        .join("\n")}`
    : "";

  return assistant(
    `Done — **${ticket.ticketNumber}** is live. ${closingLine(ticket.assigneeName, hours)}${linkedNote}`,
    {
    kind: "created",
    created: {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      assigneeName: ticket.assigneeName,
      assigneeTeam: ticket.assigneeTeam,
      assigneeEmail: ticket.assigneeEmail,
      assignmentReason: ticket.assignmentReason,
      slaDueAt: ticket.slaDueAt ? ticket.slaDueAt.toISOString() : null,
      priority: ticket.priority,
    },
    options: [{ label: "Raise another", value: "new", tone: "primary" }],
  },
  );
}
