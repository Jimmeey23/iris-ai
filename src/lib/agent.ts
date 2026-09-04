import { CATEGORIES, CATEGORY_META, TAXONOMY, type Priority } from "./taxonomy";
import { chatJson, chatJsonStreaming } from "./llm";
import { MAX_QUESTIONS, resolveClassification, tidyReply } from "./guardrails";
import { TOOL_CATALOGUE, type ToolCall, type ToolResult } from "./agent-tools";
import type { ChatMessage, ChatOption } from "./types";

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

/** Canonical slots the draft understands. The model may also invent custom ones. */
export const CANONICAL_SLOTS = [
  "studio", "raisedFor", "member", "memberContact", "trainer", "classInfo",
  "location", "systemAffected", "membershipRef", "occurredAt", "impact",
  "atRisk", "frequency", "actionTaken", "witnesses", "amount", "notes",
] as const;
export type CanonicalSlot = (typeof CANONICAL_SLOTS)[number];

export type AgentQuestion = {
  /** Canonical slot id, or `custom:<key>` for a question the taxonomy never anticipated. */
  id: string;
  ask: string;
  why?: string;
  options?: { label: string; value: string }[];
  allowFreeText?: boolean;
  placeholder?: string;
  picker?: "member" | "session" | "trainer" | "studio" | "membership";
  skipLabel?: string;
};

export type AgentIssue = {
  title: string;
  category: string;
  subcategory: string;
  summary: string;
  primary?: boolean;
};

export type AgentInsight = {
  title?: string;
  summary?: string;
  rootCause?: string;
  suggestedAction?: string;
  sentiment?: "Positive" | "Neutral" | "Negative" | "Escalated";
  emotion?: string;
  urgencyScore?: number;
  churnRisk?: "Low" | "Medium" | "High";
  effort?: "Low" | "Medium" | "High";
  priority?: Priority;
  priorityReason?: string;
  tags?: string[];
};

export type AgentTurn = {
  reply: string;
  classification: {
    category: string;
    subcategory: string;
    confidence: number;
    alternates: { category: string; subcategory: string }[];
    reason?: string;
  };
  slots: Record<string, { value: string | boolean | null; quote?: string }>;
  secondaryIssues: AgentIssue[];
  nextQuestion: AgentQuestion | null;
  readyForDraft: boolean;
  insight?: AgentInsight;
  /** Facts worth carrying onto the ticket that no slot covers. */
  extraDetails?: Record<string, string>;
  /** Momence lookups the agent wants run before it continues. */
  toolCalls?: ToolCall[];
};

export type AgentContext = {
  reporter: { name: string; role: string };
  studios: { id: number; name: string; city: string; isHq: boolean }[];
  /** Slots already filled, rendered for the model as ground truth. */
  known: Record<string, string>;
  /** Questions the agent has already put to this reporter. */
  asked: string[];
  /** How many questions are permitted in total this session. */
  questionBudget?: number;
  /** Similar recent tickets, so the agent can spot a recurring fault. */
  relatedTickets?: { ticketNumber: string; title: string; createdAt: string; status: string }[];
  momenceNote?: string;
  /** True when Momence is connected and lookups may be offered. */
  toolsEnabled?: boolean;
  /** Lookups already run this session, with their results. */
  toolResults?: ToolResult[];
};

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

function taxonomyBlock(): string {
  return CATEGORIES.map((c) => `${c}: ${TAXONOMY[c].join(", ")}`).join("\n");
}

const SYSTEM_PROMPT = `You are Iris, the intake agent for Physique 57 India — a chain of boutique barre fitness studios. Studio staff and managers report problems to you in their own words, and you turn each report into one precise, actionable ticket for the owner who will fix it.

Your job is to produce the most accurate and detailed ticket possible while asking the FEWEST questions. Every question you ask costs the reporter time on a busy studio floor.

HOW YOU THINK
- Read the whole conversation every turn. Facts stated anywhere — including mid-sentence, in passing, or in an earlier answer — are already known. Never ask for them again.
- Distinguish ROOT CAUSE from SYMPTOM. If one underlying fault produced several visible problems (a power cut causing no AC, no lights and no music), classify the ticket by the ROOT CAUSE and list the symptoms as secondary issues. Do not file the ticket under the loudest keyword.
- Read negation and absence correctly. "no music" is not a music-too-loud complaint; "no AC" is not an AC-too-cold complaint.
- Handle multiple instances. If several classes, rooms, people or times are involved, capture all of them in the slot value rather than picking the first one you see.
- Accept corrections. If the reporter revises something they said earlier, the newer statement wins.
- Infer aggressively but never invent. Only record a fact the reporter actually stated or that follows necessarily from what they said. Every slot value carries the quote it came from.

WHAT EACH SLOT MEANS — keep them distinct, they land in different ticket fields
- studio: which physical studio. Always fill it if the report names or implies one.
- raisedFor: who the report is on behalf of. ALWAYS fill it. Use exactly one of: "On behalf of a member", "Multiple members", "Noticed by staff", "Staff or trainer concern".
- member / memberContact: an individual member's identity and contact. Leave empty when no specific member is the subject.
- trainer: the person who taught or was involved. Capture the name however it is written — lowercase, initials, a nickname ("kv", "Neha", "KV Sharma") all count.
- classInfo: WHICH class — format, level and clock time ("6pm Mat 57", "10am BBB, 10.30am Cycle, 11am FIT"). List every class involved.
- occurredAt: WHEN it happened, as a time phrase only ("Just now", "Earlier today, 10:00-11:30 am"). Never put the class name here.
- location: WHERE inside the premises, never the studio name itself — a room or area ("Studio 1", "showers", "locker room", "reception"). Physical places go here.
- systemAffected: a device, platform or piece of equipment ("Momence", "POS", "speaker system", "Wi-Fi"). A room is NOT a system.
- impact: ALWAYS fill it — safety | many | single | suggestion.
- atRisk: true only when a person is in danger RIGHT NOW or the hazard is live and unguarded. A fault that could hurt someone later is not atRisk.
- membershipRef: the product the member holds or bought — "20-class pack", "annual membership", "trial". Fill it whenever one is named, even in passing.
- frequency: first time, repeat, or chronic.
- actionTaken: what the team already did on the floor. Capture it whenever anything was done.
- witnesses / amount / notes: as named.

PICKING THE CATEGORY
Choose the category whose DOMAIN owns the problem, then the best subcategory inside it. Subcategory wording that happens to appear under another category is not a reason to move the ticket there.
- money, charges, refunds, packs, renewals, pricing → Pricing and Memberships
- software, hardware, Wi-Fi, audio equipment, devices → Tech Issues or Operating Systems
- the building, its fabric, utilities and fittings → Repair and Maintenance
- a person's conduct or coaching → Trainer Feedback
- what happened inside a class → Class Experience
- injury, hazard, security → Safety and Security

WHEN TO ASK A QUESTION
Ask only when the answer would change one of: who the ticket routes to, how urgent it is, or what the owner has to physically do. Ask at most ONE question per turn, and prefer none.
Do NOT ask:
- anything already stated or safely inferable
- who the member is when the reporter says they noticed it themselves, or when no individual member is involved
- for a trainer when the report is not about a person
- a generic "anything else?" — if you have enough, go to the draft
- anything already listed in QUESTIONS ALREADY ASKED. If an earlier question went unanswered, let it go and draft the ticket without it.
Use the id "studio" — never a custom id — whenever you need to know which studio it is.
You MAY invent a question no fixed field covers, when that question is what the owner would actually need. Give it an id of "custom:<short_key>". These are often the most valuable questions you ask.
Give multiple-choice options whenever the sensible answers are enumerable — it is faster to tap than to type. Always allow free text as well.

HOW YOU SPEAK
Warm, brief, specific, like a sharp colleague. One or two sentences. Reference the actual situation in their words — never a canned line. No bullet lists, no emoji spam, no restating the whole report back.

OUTPUT
Return STRICT JSON only, matching this shape exactly:
{
  "reply": "your conversational message to the reporter — 1-2 sentences",
  "classification": {
    "category": "exact category name from the taxonomy",
    "subcategory": "exact subcategory name from that category",
    "confidence": 0.0,
    "reason": "one short clause on why this classification, naming the root cause",
    "alternates": [{"category": "...", "subcategory": "..."}]
  },
  "slots": {
    "<slotId>": {"value": "...", "quote": "the words in the transcript this came from"}
  },
  "secondaryIssues": [{"title": "...", "category": "...", "subcategory": "...", "summary": "..."}],
  "extraDetails": {"Label shown on the ticket": "value"},
  "nextQuestion": {
    "id": "<slotId or custom:key>",
    "ask": "the question, under 18 words",
    "why": "short reason it matters",
    "options": [{"label": "...", "value": "..."}],
    "allowFreeText": true,
    "placeholder": "...",
    "picker": "member|session|trainer|studio|membership",
    "skipLabel": "..."
  },
  "toolCalls": [{"tool": "...", "args": {}}],
  "readyForDraft": false,
  "insight": {
    "title": "8-12 word ticket title, specific to this incident, no trailing period",
    "summary": "2-3 sentences for the assignee covering what happened, scope and what was already done",
    "rootCause": "one sentence, grounded in the actual narrative — not a generic category statement",
    "suggestedAction": "concrete next step for the owner, referencing the specifics of this report",
    "sentiment": "Positive|Neutral|Negative|Escalated",
    "emotion": "one word",
    "urgencyScore": 0,
    "churnRisk": "Low|Medium|High",
    "effort": "Low|Medium|High",
    "priority": "Low|Medium|High|Critical",
    "priorityReason": "short justification",
    "tags": ["kebab-case"]
  }
}

Rules for the JSON:
- Slot ids you may use: ${CANONICAL_SLOTS.join(", ")} — plus any "custom:<key>".
- "impact" must be one of: safety, many, single, suggestion.
- "atRisk" must be boolean.
- "occurredAt" is a human phrase such as "Just now", "Earlier today, 10:00-11:30 am".
- "actionTaken" is anything the team already did on the floor. Capture it whenever it is mentioned — it is the most commonly lost detail.
- Always include "raisedFor" and "impact" in slots once you can infer them, even on the first turn.
- Omit "toolCalls" entirely unless you are requesting a lookup this turn.
- Emit "insight" ONLY when "readyForDraft" is true. Otherwise omit it.
- Set "nextQuestion" to null when "readyForDraft" is true, and vice versa.
- Category and subcategory MUST be copied verbatim from the taxonomy provided.`;

function renderTranscript(transcript: ChatMessage[]): string {
  return transcript
    .filter((m) => m.content?.trim())
    .slice(-24)
    .map((m) => `${m.role === "user" ? "REPORTER" : "IRIS"}: ${m.content.replace(/\n+/g, " ").trim()}`)
    .join("\n");
}

export type RunAgentOptions = {
  /**
   * Called with each newly written slice of the agent's conversational reply,
   * before the rest of the analysis has finished generating.
   */
  onReplyDelta?: (text: string) => void;
};

export async function runAgent(
  transcript: ChatMessage[],
  ctx: AgentContext,
  opts: RunAgentOptions = {},
): Promise<{ ok: boolean; turn?: AgentTurn; error?: string; latencyMs: number; model?: string }> {
  const knownLines = Object.entries(ctx.known)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const studioList = ctx.studios.map((s) => `${s.name} (${s.city})${s.isHq ? " [HQ]" : ""}`).join(" | ");

  const related = ctx.relatedTickets?.length
    ? ctx.relatedTickets
        .map((t) => `- ${t.ticketNumber} "${t.title}" (${t.status}, ${t.createdAt})`)
        .join("\n")
    : "none found";

  const user = `TAXONOMY (category: subcategories)
${taxonomyBlock()}

STUDIOS: ${studioList}

REPORTER: ${ctx.reporter.name}, ${ctx.reporter.role}

ALREADY KNOWN (do not ask about any of these):
${knownLines || "- nothing yet"}

QUESTIONS ALREADY ASKED THIS SESSION: ${ctx.asked.length ? ctx.asked.join(", ") : "none"}
QUESTION BUDGET REMAINING: ${Math.max(0, (ctx.questionBudget ?? MAX_QUESTIONS) - ctx.asked.length)}

SIMILAR RECENT TICKETS (use to spot a recurring fault; mention it if relevant):
${related}

${ctx.toolsEnabled ? TOOL_CATALOGUE : "Momence lookups are unavailable this session — do not request any."}
${
  ctx.toolResults?.length
    ? `\nLOOKUP RESULTS SO FAR (already run — never request these again):\n${ctx.toolResults
        .map((r) => `${r.tool}(${JSON.stringify(r.args ?? {})}) →\n${r.result}`)
        .join("\n\n")}`
    : ""
}
${ctx.momenceNote ? `\nMOMENCE CONTEXT:\n${ctx.momenceNote}` : ""}

CONVERSATION SO FAR
${renderTranscript(transcript)}

Produce the JSON for this turn.`;

  const params = {
    system: SYSTEM_PROMPT,
    user,
    tier: "reason" as const,
    temperature: 0.25,
    maxTokens: 1600,
    timeoutMs: 45000,
    retries: 1,
  };

  const res = opts.onReplyDelta
    ? await chatJsonStreaming<AgentTurn>({ ...params, onFieldDelta: opts.onReplyDelta })
    : await chatJson<AgentTurn>(params);

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error, latencyMs: res.latencyMs, model: res.model };
  }

  return {
    ok: true,
    turn: normaliseTurn(res.data, transcript),
    latencyMs: res.latencyMs,
    model: res.model,
  };
}

/* ------------------------------------------------------------------ */
/* Normalisation — the model is capable, not infallible                */
/* ------------------------------------------------------------------ */

function fullText(transcript: ChatMessage[]): string {
  return transcript
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ");
}

function normaliseTurn(raw: AgentTurn, transcript: ChatMessage[]): AgentTurn {
  const text = fullText(transcript);
  const resolved = resolveClassification(
    raw.classification?.category,
    raw.classification?.subcategory,
    text,
  );

  const alternates = (raw.classification?.alternates ?? [])
    .map((a) => resolveClassification(a.category, a.subcategory, text))
    .filter((a) => `${a.category}::${a.subcategory}` !== `${resolved.category}::${resolved.subcategory}`)
    .slice(0, 2)
    .map(({ category, subcategory }) => ({ category, subcategory }));

  const slots: AgentTurn["slots"] = {};
  for (const [key, entry] of Object.entries(raw.slots ?? {})) {
    if (!entry) continue;
    const value = (entry as { value?: unknown }).value;
    if (value === null || value === undefined || value === "") continue;
    slots[key] = {
      value: typeof value === "boolean" ? value : String(value),
      quote: (entry as { quote?: string }).quote,
    };
  }
  if (typeof slots.impact?.value === "string") {
    const v = slots.impact.value.toLowerCase();
    const key = ["safety", "many", "single", "suggestion"].find((k) => v.includes(k));
    if (key) slots.impact = { ...slots.impact, value: key };
    else delete slots.impact;
  }

  const nextQuestion = raw.nextQuestion?.ask
    ? {
        ...raw.nextQuestion,
        allowFreeText: raw.nextQuestion.allowFreeText ?? true,
        options: (raw.nextQuestion.options ?? []).filter((o) => o?.label).slice(0, 6),
      }
    : null;

  const toolCalls = (raw.toolCalls ?? [])
    .filter((c) => c && typeof c.tool === "string")
    .slice(0, 3);

  // A lookup turn is neither a question nor a draft — it is a pause for facts.
  const readyForDraft = toolCalls.length ? false : raw.readyForDraft === true || !nextQuestion;

  return {
    reply: tidyReply(raw.reply, "Got it."),
    classification: {
      category: resolved.category,
      subcategory: resolved.subcategory,
      confidence: clamp01(raw.classification?.confidence),
      alternates,
      reason: raw.classification?.reason,
    },
    slots,
    secondaryIssues: (raw.secondaryIssues ?? [])
      .filter((i) => i?.title)
      .slice(0, 5)
      .map((i) => {
        const r = resolveClassification(i.category, i.subcategory, `${i.title} ${i.summary ?? ""}`);
        return { ...i, category: r.category, subcategory: r.subcategory };
      }),
    extraDetails: raw.extraDetails ?? {},
    nextQuestion: readyForDraft || toolCalls.length ? null : nextQuestion,
    readyForDraft,
    toolCalls,
    insight: readyForDraft ? raw.insight : undefined,
  };
}

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.6;
  return Math.max(0, Math.min(1, v > 1 ? v / 100 : v));
}

/* ------------------------------------------------------------------ */
/* Rendering an agent question into chat options                       */
/* ------------------------------------------------------------------ */

/** Options carry their own label so the answer re-enters the transcript as words. */
export function questionOptions(q: AgentQuestion): ChatOption[] | undefined {
  const opts: ChatOption[] = (q.options ?? []).map((o) => ({
    label: o.label,
    value: `ans:${o.label}`,
  }));
  if (q.skipLabel) opts.push({ label: q.skipLabel, value: `ans:${q.skipLabel}`, tone: "ghost" });
  return opts.length ? opts : undefined;
}

export function categoryIcon(category: string): string {
  return CATEGORY_META[category]?.icon ?? "🎫";
}
