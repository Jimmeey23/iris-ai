import { classify, detectPriority, detectSentiment, suggestTags } from "./ai";
import { CATEGORIES, TAXONOMY, type Priority } from "./taxonomy";
import { computeSla, type Severity, type SlaOverrides } from "./sla";
import { getOpenAiKey, getSetting } from "./settings";
import { chatJson, modelFor } from "./llm";
import { enforceAtRisk, enforcePriority, enforceUrgency, plannedWorkCeiling } from "./guardrails";
import type { AgentInsight } from "./agent";

/** Reads the admin-configured category-level SLA overrides, if any are saved. */
export async function getSlaOverrides(): Promise<SlaOverrides | undefined> {
  const raw = await getSetting("sla_overrides");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as SlaOverrides;
  } catch {
    return undefined;
  }
}

export type AiInsight = {
  title: string;
  summary: string;
  sentiment: "Positive" | "Neutral" | "Negative" | "Escalated";
  emotion: string;
  urgencyScore: number;
  churnRisk: "Low" | "Medium" | "High";
  effort: "Low" | "Medium" | "High";
  rootCause: string;
  suggestedAction: string;
  priority: Priority;
  priorityReason: string;
  tags: string[];
  confidence: number;
  engine: string;
  category?: string;
  subcategory?: string;
  severity: Severity;
  slaRespondHours: number;
  slaResolveHours: number;
  slaPolicy: string;
  slaReason: string;
};

const EMOTION_RULES: { test: RegExp; emotion: string }[] = [
  { test: /furious|outrage|unacceptable|disgust|appall/i, emotion: "Outraged" },
  { test: /angry|upset|annoyed|irritat|frustrat/i, emotion: "Frustrated" },
  { test: /scared|unsafe|afraid|worried|anxious|nervous/i, emotion: "Concerned" },
  { test: /disappoint|let down|expected better|sad/i, emotion: "Disappointed" },
  { test: /confus|unclear|don'?t understand|not sure/i, emotion: "Confused" },
  { test: /love|amazing|great|thank|apprecia|excellent|kudos/i, emotion: "Delighted" },
  { test: /suggest|idea|would be nice|recommend|request/i, emotion: "Constructive" },
];

const CHURN_SIGNALS =
  /(cancel|refund|quit|leaving|switch|competitor|not renew|stop coming|last straw|third time|again and again|escalate)/i;
const EFFORT_HIGH =
  /(replace|install|renovat|vendor|structural|contractor|new system|migrat|overhaul|policy change)/i;
const EFFORT_LOW = /(remind|inform|clean|restock|reset|adjust|refill|move|tell|note)/i;
/** Anything that needs someone outside the studio team to act. */
const THIRD_PARTY =
  /(electric|power ?(?:cut|outage|failure)|no electricity|grid|bescom|bses|adani|tata power|mseb|generator|\bdg\b|building management|landlord|society|bmc|vendor|technician|amc|plumber|electrician|isp|broadband|internet provider)/i;

/** Openers that carry no ticket meaning — a chat "hi" must never reach a title. */
const GREETING_PREFIX =
  /^(?:h(?:i+|ey+|ello)|yo|hola|namaste|good\s+(?:morning|afternoon|evening|day)|morning|afternoon|evening|team|guys|folks)\b[\s,.!:;—–-]*/i;
const REPORT_PREAMBLE =
  /^(?:a\s+|the\s+)?(?:member|client|guest|customer|she|he|they|someone)?\s*(?:has\s+)?(?:just\s+)?(?:complained|reported|mentioned|said|says|told me|flagged|raised|informed|noticed|wanted to (?:flag|report))\s*(?:that\s+|about\s+)?/i;

/** Strip greetings and reporting preamble, however many are stacked up front. */
function stripPreamble(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(GREETING_PREFIX, "").replace(REPORT_PREAMBLE, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Clock times ("10 am", "10.30am", "6:15 pm") — used to size the blast radius. */
const CLOCK_TIME = /\b\d{1,2}[.:]?\d{0,2}\s*(?:am|pm)\b/gi;

function countDistinctTimes(text: string): number {
  const seen = new Set(
    (text.match(CLOCK_TIME) ?? []).map((t) => t.toLowerCase().replace(/[\s.:]/g, "")),
  );
  return seen.size;
}

/**
 * A ticket title is a label, not a transcript slice. A short, single-clause
 * report can speak for itself; anything longer gets a structured title built
 * from what the ticket actually is, so an owner scanning a queue can read it.
 */
function composeTitle(input: {
  text: string;
  /** The reporter's opening description, before any answers were appended. */
  opening?: string;
  subcategory: string;
  studioName?: string;
  classInfo?: string;
  resolvedNow?: boolean;
  plannedWork?: boolean;
}): string {
  // Titles are built from the report, not from the report plus every answer
  // that followed it. Joining "the washing machine stopped working" to
  // "Kwality House, Kemps Corner" and "Still happening" produces a run-on that
  // no headline rule can match, so the title fell back to the subcategory
  // label — a filing choice masquerading as a description of the problem.
  const clean = stripPreamble(input.opening?.trim() || input.text || "");
  const place =
    input.studioName && input.studioName !== "Not studio specific"
      ? ` — ${input.studioName.split(",")[0].trim()}`
      : "";

  const firstSentence = (clean.split(/(?<=[.!?])\s/)[0] ?? clean).replace(/[.\s]+$/, "");
  const words = firstSentence ? firstSentence.split(/\s+/) : [];
  const singleClause = !/[,;]|\s[-–—]\s/.test(firstSentence);

  // The reporter's own words win only when they already read as a headline.
  if (words.length >= 4 && words.length <= 14 && singleClause) {
    return firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  }

  const scope: string[] = [];
  const classes = input.classInfo ? countDistinctTimes(input.classInfo) : 0;
  const times = classes || countDistinctTimes(stripPreamble(input.text ?? ""));
  if (times >= 2) scope.push(`${times} classes affected`);
  // "still unresolved" is nonsense about work that has not started yet.
  if (input.plannedWork) scope.push("scheduled");
  else if (input.resolvedNow === false) scope.push("still unresolved");

  const label = `${input.subcategory}${place}`;
  return scope.length ? `${label} (${scope.join(", ")})` : label;
}

/** Deterministic on-device enrichment — always available, no API key required. */
export function localEnrich(input: {
  text: string;
  /** The reporter's first substantive message, used for the title. */
  opening?: string;
  category: string;
  subcategory: string;
  impact?: string;
  atRisk?: boolean;
  studioName?: string;
  memberName?: string;
  trainerName?: string;
  classInfo?: string;
  resolvedNow?: boolean;
  plannedWork?: boolean;
  slaOverrides?: SlaOverrides;
}): AiInsight {
  const text = input.text || `${input.subcategory} at ${input.studioName ?? "studio"}`;
  const sentiment = detectSentiment(text);
  // A live-risk claim with no hazard in the report is not evidence.
  const atRisk = enforceAtRisk(input.atRisk, text);
  // Scheduled work has no "still happening" state to compress the clock with —
  // nothing is broken yet, so the live-fault path must not apply to it.
  const resolvedNow = input.plannedWork ? undefined : input.resolvedNow;
  const detected = detectPriority({
    text,
    category: input.category,
    impact: input.impact,
    atRisk,
  });
  const ceiling = plannedWorkCeiling(detected.priority, {
    plannedWork: input.plannedWork,
    atRisk,
    impact: input.impact,
    text,
  });
  const priority = ceiling.priority;
  const reason = ceiling.capped
    ? `${detected.reason} · capped at Medium: scheduled work, not an incident`
    : detected.reason;

  const emotion = EMOTION_RULES.find((r) => r.test.test(text))?.emotion ??
    (sentiment === "Negative" ? "Dissatisfied" : sentiment === "Positive" ? "Delighted" : "Informational");

  const urgencyBase: Record<Priority, number> = { Critical: 94, High: 76, Medium: 52, Low: 26 };
  let urgencyScore = urgencyBase[priority];
  if (sentiment === "Escalated") urgencyScore = Math.min(99, urgencyScore + 8);
  if (input.impact === "many") urgencyScore = Math.min(99, urgencyScore + 5);
  if (input.impact === "suggestion") urgencyScore = Math.max(10, urgencyScore - 12);
  // A fault the reporter has confirmed is STILL happening is live work, not a
  // write-up. Confirmed-resolved earns the opposite nudge.
  if (resolvedNow === false) urgencyScore = Math.min(99, urgencyScore + 6);
  else if (resolvedNow === true) urgencyScore = Math.max(10, urgencyScore - 8);

  const churnRisk: AiInsight["churnRisk"] = CHURN_SIGNALS.test(text)
    ? "High"
    : sentiment === "Escalated" || sentiment === "Negative"
      ? "Medium"
      : "Low";

  // EFFORT_LOW matches words like "move" and "provided", which a floor
  // workaround always contains — so a workaround must never be mistaken for the
  // fix. An unresolved fault, or one that needs a third party, is not Low.
  const effort: AiInsight["effort"] = EFFORT_HIGH.test(text)
    ? "High"
    : resolvedNow === false || THIRD_PARTY.test(text)
      ? "Medium"
      : EFFORT_LOW.test(text)
        ? "Low"
        : "Medium";

  const rootCause = deriveRootCause(input.category, input.subcategory, text, input.plannedWork);
  const suggestedAction = deriveAction(input.category, input.subcategory, input.memberName);

  const subject = [
    input.subcategory,
    input.studioName && input.studioName !== "Not studio specific" ? `at ${input.studioName}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const who = input.memberName ? ` Reported for ${input.memberName}.` : "";
  const trainer = input.trainerName ? ` Trainer involved: ${input.trainerName}.` : "";

  const sla = computeSla({
    category: input.category,
    subcategory: input.subcategory,
    urgencyScore,
    churnRisk,
    sentiment,
    impact: input.impact,
    atRisk: atRisk,
    resolvedNow,
    plannedWork: input.plannedWork,
    overrides: input.slaOverrides,
  });

  return {
    severity: sla.severity,
    slaRespondHours: sla.respondHours,
    slaResolveHours: sla.resolveHours,
    slaPolicy: sla.policyLabel,
    slaReason: sla.reason,
    title: composeTitle({
      text: input.text,
      opening: input.opening,
      subcategory: input.subcategory,
      studioName: input.studioName,
      classInfo: input.classInfo,
      resolvedNow,
      plannedWork: input.plannedWork,
    }),
    summary: `${subject}.${who}${trainer} Tone reads ${sentiment.toLowerCase()} (${emotion.toLowerCase()}); ${priority.toLowerCase()} priority with ${effort.toLowerCase()} expected effort.`,
    sentiment,
    emotion,
    urgencyScore,
    churnRisk,
    effort,
    rootCause,
    suggestedAction,
    priority: (() => {
      const order: Priority[] = ["Low", "Medium", "High", "Critical"];
      return order[Math.max(order.indexOf(priority), order.indexOf(sla.priority))];
    })(),
    priorityReason: `${reason} · ${sla.reason}`,
    tags: suggestTags(text, input.category, input.subcategory),
    confidence: 78,
    engine: "Iris NLU (on-device)",
  };
}

/**
 * Narrative-driven root causes. These beat the category default because the
 * category default is a guess about the class of problem, while these read the
 * actual fault the reporter described. Order matters — first match wins.
 */
const ROOT_CAUSE_SIGNALS: { test: RegExp; cause: string }[] = [
  {
    // A partial outage (one room still live) is a distribution or phase fault
    // inside the premises, not a supply failure — very different owner.
    test: /(power|electric|electricity|outage|no light)/i,
    cause:
      "Loss of electrical supply to the studio. Confirm whether it was a building/grid-side outage or an internal distribution fault — if any room kept power, suspect a circuit, phase or DB fault on our side rather than the supply.",
  },
  { test: /(water (?:leak|seep)|leak|drip|overflow|blocked drain|no water)/i, cause: "Plumbing or drainage fault — locate the source before cosmetic repair." },
  { test: /(not cooling|no ac|ac (?:not|isn'?t) work|hvac|compressor|gas (?:leak|refill))/i, cause: "HVAC unit underperforming — likely refrigerant, filter or servicing overdue on that unit." },
  { test: /(wifi|internet|broadband|network (?:down|drop))/i, cause: "Connectivity fault — isolate router, ISP link and the device before escalating." },
  { test: /(mic|speaker|audio|sound system|music (?:not|stopped|cut))/i, cause: "AV chain fault — trace mic, receiver, mixer and speaker in turn." },
  { test: /(momence|booking system|pos|payment gateway|app (?:crash|down)|not syncing)/i, cause: "Platform fault or sync failure — reproduce, capture the error and raise with the vendor." },
  { test: /(double charge|charged twice|incorrect charge|auto.?debit|refund)/i, cause: "Billing configuration or policy-communication mismatch between what was sold and what the system charged." },
  { test: /(injur|slip|fell|fainted|bled|sprain)/i, cause: "Member injured during activity — establish whether cause was equipment, surface, instruction or a pre-existing condition." },
];

function deriveRootCause(category: string, subcategory: string, text = "", plannedWork = false): string {
  // Scheduled work is not a fault, so it has no root cause to diagnose. Saying
  // "likely deferred preventive maintenance" about a planned renovation is
  // both wrong and insulting to the person who planned it.
  if (plannedWork) {
    return `${subcategory}: Planned work notified in advance — no fault to diagnose. The ticket exists so the closure is scheduled, classes are moved and members are told in good time.`;
  }
  const signal = ROOT_CAUSE_SIGNALS.find((r) => r.test.test(text));
  if (signal) return `${subcategory}: ${signal.cause}`;
  const map: Record<string, string> = {
    "Repair and Maintenance": "Likely deferred preventive maintenance or an unlogged asset fault.",
    "Studio Amenities and Facilities": "Housekeeping cadence or consumable stock levels not matching footfall.",
    "Trainer Feedback": "Coaching consistency gap — worth checking against the trainer's recent audit scores.",
    "Class Experience": "Class delivery standard drifting from the Physique 57 format playbook.",
    Scheduling: "Timetable capacity not aligned to current demand patterns at this studio.",
    "Operating Systems": "Platform sync or configuration fault in a core operating system.",
    "Tech Issues": "Hardware or connectivity fault at the studio; check device age and last service.",
    "Pricing and Memberships": "Policy communication gap between sales collateral and system behaviour.",
    "Customer Service and Communication": "Response SLA or ownership gap in the front-of-house workflow.",
    "Brand Feedback": "Brand execution deviating from the central guideline pack.",
    "Safety and Security": "Compliance control not being enforced in the daily opening/closing checklist.",
    "Theft and Lost Items": "Access control and lost-and-found custody process needs tightening.",
    Miscellaneous: "Environmental or ambience factor outside standard checklists.",
  };
  return `${subcategory}: ${map[category] ?? "Requires owner investigation to confirm the driver."}`;
}

function deriveAction(category: string, subcategory: string, memberName?: string): string {
  const followUp = memberName ? ` Close the loop with ${memberName} once actioned.` : "";
  const map: Record<string, string> = {
    "Repair and Maintenance": "Raise a vendor job, put an interim mitigation in place and confirm the fix with a photo.",
    "Studio Amenities and Facilities": "Run an immediate spot-check, restock or deep-clean, and add to the daily checklist.",
    "Trainer Feedback": "Share the feedback 1:1 with the trainer, log it in their file and schedule a class observation.",
    "Class Experience": "Review the class recording/format notes with the head trainer and brief the team.",
    Scheduling: "Review booking demand for the slot and propose a timetable amendment for approval.",
    "Operating Systems": "Reproduce the fault, capture screenshots and raise with the platform vendor.",
    "Tech Issues": "Swap to the backup device, log the hardware fault and arrange a service visit.",
    "Pricing and Memberships": "Pull the member's billing history, confirm the policy position and issue a written response.",
    "Customer Service and Communication": "Acknowledge within the hour, assign a single owner and set a follow-up reminder.",
    "Brand Feedback": "Route to the brand guideline owner and confirm corrective creative or collateral.",
    "Safety and Security": "Escalate to the compliance officer immediately, secure the area and file an incident report.",
    "Theft and Lost Items": "Pull CCTV for the window, log the item and follow the theft investigation protocol.",
    Miscellaneous: "Assess on site, apply a quick fix and note it in the studio log.",
  };
  return `${map[category] ?? "Investigate and respond."}${followUp}`;
}

/* ------------------------------------------------------------------ */
/* Optional OpenAI enrichment                                          */
/* ------------------------------------------------------------------ */

export async function hasOpenAi(): Promise<boolean> {
  const key = await getOpenAiKey();
  return key.startsWith("sk-");
}

type OpenAiPayload = {
  title?: string;
  summary?: string;
  category?: string;
  subcategory?: string;
  sentiment?: string;
  emotion?: string;
  urgencyScore?: number;
  churnRisk?: string;
  effort?: string;
  rootCause?: string;
  suggestedAction?: string;
  priority?: string;
  priorityReason?: string;
  tags?: string[];
  confidence?: number;
};

/** Upgrade the local insight with an LLM pass when a key is configured. */
export async function aiEnrich(input: {
  text: string;
  category: string;
  subcategory: string;
  impact?: string;
  atRisk?: boolean;
  studioName?: string;
  memberName?: string;
  trainerName?: string;
  classInfo?: string;
  membershipRef?: string;
  resolvedNow?: boolean;
  plannedWork?: boolean;
}): Promise<AiInsight> {
  const slaOverrides = await getSlaOverrides();
  const base = localEnrich({ ...input, slaOverrides });
  const key = await getOpenAiKey();
  if (!key.startsWith("sk-")) return base;
  const model = await modelFor("reason");

  const allowed = TAXONOMY[input.category] ?? [];
  const prompt = `You are Iris, the ticket triage analyst for Physique 57 (boutique barre fitness studios in India).
Analyse this internal report and return STRICT JSON only.

Report: "${input.text}"
Pre-classified category: ${input.category}
Pre-classified subcategory: ${input.subcategory}
Studio: ${input.studioName ?? "unknown"}
Member: ${input.memberName ?? "n/a"} | Trainer: ${input.trainerName ?? "n/a"} | Class: ${input.classInfo ?? "n/a"} | Membership: ${input.membershipRef ?? "n/a"}
Stated impact: ${input.impact ?? "unknown"} | Immediate risk flagged: ${input.atRisk ? "yes" : "no"}
Current state: ${input.resolvedNow === true ? "reporter confirms it is RESOLVED" : input.resolvedNow === false ? "reporter confirms it is STILL HAPPENING — this is live work" : "unknown"}
Root cause must describe the fault actually narrated above, never a generic statement about the category. A workaround put in place on the floor is not the fix — do not score effort as Low because of it.

Valid categories: ${CATEGORIES.join(" | ")}
Valid subcategories for ${input.category}: ${allowed.join(" | ")}

Return JSON with exactly these keys:
{"title": "concise 8-12 word ticket title, no trailing period",
 "summary": "2 sentence professional summary for the assignee",
 "category": "one of the valid categories",
 "subcategory": "one of the valid subcategories for the chosen category",
 "sentiment": "Positive|Neutral|Negative|Escalated",
 "emotion": "one word emotional read",
 "urgencyScore": 0-100,
 "churnRisk": "Low|Medium|High",
 "effort": "Low|Medium|High",
 "rootCause": "one sentence probable root cause",
 "suggestedAction": "one or two sentence recommended next action for the owner",
 "priority": "Low|Medium|High|Critical",
 "priorityReason": "short justification",
 "tags": ["3-5 kebab-case tags"],
 "confidence": 0-100}`;

  const res = await chatJson<OpenAiPayload>({
    system: "You are the ticket triage analyst. Return only valid minified JSON. No prose.",
    user: prompt,
    tier: "reason",
    temperature: 0.2,
    maxTokens: 800,
    timeoutMs: 20000,
    retries: 1,
    feature: "triage",
  });
  if (!res.ok || !res.data) return base;
  {
    const parsed = res.data;

    const category = CATEGORIES.includes(parsed.category ?? "") ? parsed.category! : input.category;
    const subcategory = (TAXONOMY[category] ?? []).includes(parsed.subcategory ?? "")
      ? parsed.subcategory!
      : input.subcategory;

    // The model's priority proposal is real judgement; the deterministic floor
    // may only raise it. SLA never softens either of them.
    const enforced = enforcePriority(
      parsed.priority as Priority | undefined,
      input.text,
      parsed.priorityReason?.trim() || base.priorityReason,
    );
    const mergedUrgency =
      typeof parsed.urgencyScore === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.urgencyScore)))
        : base.urgencyScore;
    const mergedChurn = (["Low", "Medium", "High"].includes(parsed.churnRisk ?? "")
      ? parsed.churnRisk
      : base.churnRisk) as AiInsight["churnRisk"];
    const mergedSentiment = (["Positive", "Neutral", "Negative", "Escalated"].includes(parsed.sentiment ?? "")
      ? parsed.sentiment
      : base.sentiment) as AiInsight["sentiment"];
    const sla = computeSla({
      category,
      subcategory,
      urgencyScore: mergedUrgency,
      churnRisk: mergedChurn,
      sentiment: mergedSentiment,
      impact: input.impact,
      atRisk: input.atRisk,
      resolvedNow: input.resolvedNow,
      overrides: slaOverrides,
    });

    return {
      severity: sla.severity,
      slaRespondHours: sla.respondHours,
      slaResolveHours: sla.resolveHours,
      slaPolicy: sla.policyLabel,
      slaReason: sla.reason,
      title: parsed.title?.trim() || base.title,
      summary: parsed.summary?.trim() || base.summary,
      sentiment: (["Positive", "Neutral", "Negative", "Escalated"].includes(parsed.sentiment ?? "")
        ? parsed.sentiment
        : base.sentiment) as AiInsight["sentiment"],
      emotion: parsed.emotion?.trim() || base.emotion,
      urgencyScore: enforceUrgency(
        typeof parsed.urgencyScore === "number"
          ? Math.max(0, Math.min(100, Math.round(parsed.urgencyScore)))
          : base.urgencyScore,
        sla.priority,
      ),
      churnRisk: (["Low", "Medium", "High"].includes(parsed.churnRisk ?? "")
        ? parsed.churnRisk
        : base.churnRisk) as AiInsight["churnRisk"],
      effort: (["Low", "Medium", "High"].includes(parsed.effort ?? "")
        ? parsed.effort
        : base.effort) as AiInsight["effort"],
      rootCause: parsed.rootCause?.trim() || base.rootCause,
      suggestedAction: parsed.suggestedAction?.trim() || base.suggestedAction,
      priority: (() => {
        const order: Priority[] = ["Low", "Medium", "High", "Critical"];
        return order[Math.max(order.indexOf(enforced.priority), order.indexOf(sla.priority))];
      })(),
      priorityReason: [enforced.reason, sla.reason].filter(Boolean).join(" · "),
      tags: Array.isArray(parsed.tags) && parsed.tags.length ? parsed.tags.slice(0, 6) : base.tags,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
          : 90,
      engine: `OpenAI ${model}`,
      category,
      subcategory,
    };
  }
}

/** Classify free text, optionally sharpened by the LLM. */
export function quickClassify(text: string) {
  return classify(text, 4);
}

/* ------------------------------------------------------------------ */
/* Agent-produced insight → canonical AiInsight                        */
/* ------------------------------------------------------------------ */

/**
 * Turn the intake agent's narrative judgement into the shape the ticket
 * expects. Everything the agent is good at (title, root cause, action, tone)
 * is taken as-is; everything that must be consistent and auditable (priority
 * floor, urgency banding, SLA) is recomputed deterministically here.
 *
 * This is the single scorer — the draft preview and the raised ticket both
 * come through this function, so they can never disagree.
 */
export async function insightFromAgent(input: {
  agent?: AgentInsight;
  text: string;
  opening?: string;
  category: string;
  subcategory: string;
  impact?: string;
  atRisk?: boolean;
  studioName?: string;
  memberName?: string;
  trainerName?: string;
  classInfo?: string;
  resolvedNow?: boolean;
  plannedWork?: boolean;
  model?: string;
  confidence?: number;
}): Promise<AiInsight> {
  const slaOverrides = await getSlaOverrides();
  const base = localEnrich({ ...input, slaOverrides });
  const a = input.agent;
  if (!a) return base;

  const sentiment = (["Positive", "Neutral", "Negative", "Escalated"] as const).includes(
    a.sentiment as never,
  )
    ? (a.sentiment as AiInsight["sentiment"])
    : base.sentiment;

  // The model's own escalation gets the same scrutiny as the on-device one: a
  // live-risk claim needs a hazard in the report, and scheduled work with no
  // hazard cannot be Critical however urgent the model felt about it.
  const atRisk = enforceAtRisk(input.atRisk, input.text);
  const resolvedNow = input.plannedWork ? undefined : input.resolvedNow;
  const raised = enforcePriority(a.priority, input.text, a.priorityReason);
  const ceiling = plannedWorkCeiling(raised.priority, {
    plannedWork: input.plannedWork,
    atRisk,
    impact: input.impact,
    text: input.text,
  });
  const priority = ceiling.priority;
  const reason = ceiling.capped
    ? `${raised.reason} · capped at Medium: scheduled work, not an incident`
    : raised.reason;
  const provisionalUrgency = enforceUrgency(a.urgencyScore, priority);

  const churnRisk = (["Low", "Medium", "High"] as const).includes(a.churnRisk as never)
    ? (a.churnRisk as AiInsight["churnRisk"])
    : base.churnRisk;
  const effort = (["Low", "Medium", "High"] as const).includes(a.effort as never)
    ? (a.effort as AiInsight["effort"])
    : base.effort;

  const sla = computeSla({
    category: input.category,
    subcategory: input.subcategory,
    urgencyScore: provisionalUrgency,
    churnRisk,
    sentiment,
    impact: input.impact,
    atRisk,
    resolvedNow,
    plannedWork: input.plannedWork,
    overrides: slaOverrides,
  });

  // SLA may only escalate priority further, never soften the guardrail floor.
  const order: Priority[] = ["Low", "Medium", "High", "Critical"];
  const finalPriority = plannedWorkCeiling(
    order[Math.max(order.indexOf(priority), order.indexOf(sla.priority))],
    { plannedWork: input.plannedWork, atRisk, impact: input.impact, text: input.text },
  ).priority;
  // Re-band against the priority that actually ships, or a ticket can read
  // "High" next to an urgency of 35.
  const urgencyScore = enforceUrgency(provisionalUrgency, finalPriority);

  return {
    title: (a.title?.trim() || base.title).slice(0, 140),
    summary: a.summary?.trim() || base.summary,
    sentiment,
    emotion: a.emotion?.trim() || base.emotion,
    urgencyScore,
    churnRisk,
    effort,
    rootCause: a.rootCause?.trim() || base.rootCause,
    suggestedAction: a.suggestedAction?.trim() || base.suggestedAction,
    priority: finalPriority,
    priorityReason: [reason, sla.reason].filter(Boolean).join(" · "),
    tags: Array.isArray(a.tags) && a.tags.length ? a.tags.slice(0, 6) : base.tags,
    confidence: Math.max(0, Math.min(100, Math.round((input.confidence ?? 0.6) * 100))),
    engine: input.model ? `Iris Agent (${input.model})` : "Iris Agent",
    category: input.category,
    subcategory: input.subcategory,
    severity: sla.severity,
    slaRespondHours: sla.respondHours,
    slaResolveHours: sla.resolveHours,
    slaPolicy: sla.policyLabel,
    slaReason: sla.reason,
  };
}
