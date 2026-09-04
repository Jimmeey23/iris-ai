import {
  buildDraft,
  handleInput,
  reviewMessage,
  startSession,
  assistantMessage,
  type EngineContext,
  type EngineInput,
  type EngineResult,
  type IntakeState,
} from "./chat-engine";
import { CATEGORY_DEPARTMENT } from "./org";
import { CATEGORY_META } from "./taxonomy";
import { applyComposerContext, IMPACT_LABEL } from "./chat-inference";
import { runAgent, questionOptions, type AgentContext, type AgentQuestion } from "./agent";
import { missingRequired, questionBudget } from "./guardrails";
import { insightFromAgent } from "./enrich";
import { findRelatedTickets } from "./recurrence";
import type { ChatMessage, ChatOption } from "./types";

/** Steps owned by the deterministic review / edit machinery, not the agent. */
const DETERMINISTIC_STEPS = new Set(["review", "edit_menu", "created"]);
const DETERMINISTIC_VALUES = new Set(["approve", "edit", "restart", "new", "undo"]);

function isDeterministic(state: IntakeState, input: EngineInput): boolean {
  const value = input.value ?? "";
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

  if (value.startsWith("ans:")) return { utterance: value.slice(4), inferred };

  if (value.startsWith("studio:")) {
    const rest = value.slice(7);
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
    return { utterance: `The member is ${d.memberName}.`, inferred };
  }

  if (value.startsWith("session:")) {
    const [, id, ...rest] = value.split(":");
    d.momenceSessionId = Number(id);
    const [name, at, teacher] = rest.join(":").split("|");
    d.classInfo = name;
    if (at) d.classAt = at;
    if (teacher && !d.trainerName) d.trainerName = teacher;
    return {
      utterance: `The class was ${[name, at, teacher && `taught by ${teacher}`].filter(Boolean).join(", ")}.`,
      inferred,
    };
  }

  if (value.startsWith("trainer:")) {
    d.trainerName = value.slice(8);
    return { utterance: `The trainer was ${d.trainerName}.`, inferred };
  }

  if (value.startsWith("membership:") || value.startsWith("mem:")) {
    d.membershipRef = value.replace(/^(membership|mem):/, "");
    return { utterance: `Membership: ${d.membershipRef}.`, inferred };
  }

  if (value === "skip") return { utterance: "Skip that one.", inferred };
  if (value === "browse") return { utterance: "Let me pick the category myself.", inferred };
  if (value.startsWith("cat:")) {
    d.category = value.slice(4);
    d.subcategory = undefined;
    return { utterance: `File this under ${d.category}.`, inferred };
  }
  if (value.startsWith("sub:")) {
    d.subcategory = value.slice(4);
    return { utterance: `The subcategory is ${d.subcategory}.`, inferred };
  }

  return { utterance: text, inferred };
}

/* ------------------------------------------------------------------ */
/* Agent slots → intake data                                           */
/* ------------------------------------------------------------------ */

function applySlots(
  slots: Record<string, { value: string | boolean | null }>,
  s: IntakeState,
  ctx: EngineContext,
): void {
  const d = s.data;
  for (const [slot, entry] of Object.entries(slots)) {
    const v = entry?.value;
    if (v === null || v === undefined || v === "") continue;
    const str = typeof v === "boolean" ? String(v) : v;

    switch (slot) {
      case "studio": {
        if (d.studioName !== undefined) break; // an explicit pick always wins
        const match = ctx.studios.find(
          (st) =>
            str.toLowerCase().includes(st.name.toLowerCase()) ||
            st.name.toLowerCase().includes(str.toLowerCase().split(",")[0].trim()),
        );
        if (match) {
          d.studioId = match.id;
          d.studioName = `${match.name}, ${match.city}`;
        } else if (/not studio|all studios|n\/a/i.test(str)) {
          d.studioId = null;
          d.studioName = "Not studio specific";
        }
        break;
      }
      case "raisedFor": d.raisedFor = str; break;
      case "member": d.memberName = str; break;
      case "memberContact": d.memberContact = str; break;
      case "trainer": d.trainerName = str; break;
      case "classInfo": d.classInfo = str; break;
      case "location": d.location = str; break;
      case "systemAffected": d.systemAffected = str; break;
      case "membershipRef": d.membershipRef = str; break;
      case "occurredAt": d.occurredAt = str; break;
      case "impact": d.impact = str; break;
      case "atRisk": d.atRisk = v === true || /^(true|yes)$/i.test(str); break;
      case "frequency": d.frequency = str; break;
      case "actionTaken": d.actionTaken = str; break;
      case "witnesses": d.witnesses = str; break;
      case "amount": d.amount = str; break;
      case "notes": d.notes = str; break;
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

function knownForAgent(s: IntakeState): Record<string, string> {
  const d = s.data;
  const known: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") known[k] = String(v);
  };
  put("studio", d.studioName);
  put("raisedFor", d.raisedFor);
  put("member", d.memberName);
  put("memberContact", d.memberContact);
  put("trainer", d.trainerName);
  put("classInfo", d.classInfo);
  put("classAt", d.classAt);
  put("location", d.location);
  put("systemAffected", d.systemAffected);
  put("membershipRef", d.membershipRef);
  put("occurredAt", d.occurredAt);
  put("impact", d.impact ? (IMPACT_LABEL[d.impact] ?? d.impact) : undefined);
  put("atRisk", d.atRisk);
  put("frequency", d.frequency);
  put("actionTaken", d.actionTaken);
  put("witnesses", d.witnesses);
  put("amount", d.amount);
  put("notes", d.notes);
  for (const [k, v] of Object.entries(d.extraDetails ?? {})) put(k, v);
  return known;
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
  const content = reply ? `${reply}\n\n${body}` : body;
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

export type AgentTurnResult = EngineResult & {
  usedAgent: boolean;
  degraded?: string;
  /**
   * The reporter's turn as plain words — including option and picker clicks —
   * so the caller can persist a transcript the agent can re-read next turn.
   */
  userUtterance?: string;
};

export async function runAgentTurn(
  state: IntakeState,
  transcript: ChatMessage[],
  input: EngineInput,
  ctx: EngineContext,
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
  };

  const { utterance, inferred } = absorbInput(input, s, ctx);
  if (!s.data.rawText && utterance) s.data.rawText = utterance;

  // Nothing was actually said — don't spend a model call on an empty turn.
  const hasNarrative = utterance || transcript.some((m) => m.role === "user" && m.content.trim());
  if (!hasNarrative) {
    return {
      state: s,
      usedAgent: false,
      messages: [
        assistantMessage(
          "Tell me what happened in your own words — I'll work out the rest and only ask about the gaps.",
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

  const related = await findRelatedTickets({
    text: narrative,
    studioId: s.data.studioId,
    category: s.data.category,
  }).catch(() => []);

  const agentCtx: AgentContext = {
    reporter: ctx.reporter,
    studios: ctx.studios.map((st) => ({ id: st.id, name: st.name, city: st.city, isHq: st.isHq })),
    known: knownForAgent(s),
    asked: s.agentAsked ?? [],
    questionBudget: budget,
    relatedTickets: related.map((r) => ({
      ticketNumber: r.ticketNumber,
      title: r.title,
      createdAt: r.createdAt,
      status: r.status,
    })),
    momenceNote: s.data.momenceContext ? JSON.stringify(s.data.momenceContext) : undefined,
  };

  const result = await runAgent(convo, agentCtx);

  // Model unavailable or malformed — fall back to the on-device engine so
  // intake never dead-ends.
  if (!result.ok || !result.turn) {
    const legacy = handleInput(state, input, ctx);
    return { ...legacy, usedAgent: false, degraded: result.error };
  }

  const turn = result.turn;
  if (!s.data.category || turn.classification.confidence >= 0.5) {
    s.data.category = turn.classification.category;
    s.data.subcategory = turn.classification.subcategory;
  }
  applySlots(turn.slots, s, ctx);
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

  const budgetSpent = (s.agentAsked?.length ?? 0) >= budget;
  const missing = missingRequired(s.data);
  let question = turn.nextQuestion;

  // A question about the studio is the studio question, whatever the model
  // decided to call it — that keeps the picker and the dedupe below honest.
  if (question && /studio|location of the studio|which studio/i.test(question.id + " " + question.ask)) {
    if (missing.includes("studio")) question = { ...question, id: "studio", allowFreeText: false };
  }

  // Studio drives routing, so it is the one thing we will always ask for.
  if (!question && missing.includes("studio")) {
    question = { id: "studio", ask: "Last thing — which studio is this?", allowFreeText: false };
  }

  // Never ask the same thing twice. If the answer did not land the first time,
  // asking again just loops the reporter — take what we have and draft.
  if (question && (s.agentAsked ?? []).includes(question.id)) {
    question =
      question.id !== "studio" && missing.includes("studio")
        ? { id: "studio", ask: "Last thing — which studio is this?", allowFreeText: false }
        : null;
    if (question && (s.agentAsked ?? []).includes(question.id)) question = null;
  }

  if (budgetSpent && question && !missing.includes("studio")) question = null;

  const first = (state.agentAsked?.length ?? 0) === 0 && state.step === "describe";

  if (question) {
    s.step = "agent_q";
    s.pendingQuestionId = question.id;
    s.agentAsked = [...(s.agentAsked ?? []), question.id];
    const messages: ChatMessage[] = [];
    if (first) {
      messages.push(
        assistantMessage(turn.reply, {
          analysis: analysisChips(s, turn.classification.confidence),
          ...(inferred.length ? { inferred } : {}),
        }),
      );
      messages.push(questionMessage(question, "", s, ctx, [], budget));
    } else {
      messages.push(questionMessage(question, turn.reply, s, ctx, inferred, budget));
    }
    return { state: s, messages, usedAgent: true, userUtterance: utterance };
  }

  // Ready for the draft. If the studio was never established, say so on the
  // ticket rather than leaving the field blank.
  if (s.data.studioName === undefined) {
    s.data.studioId = null;
    s.data.studioName = "Not studio specific";
  }

  const insight = await insightFromAgent({
    agent: turn.insight,
    text: narrative,
    category: s.data.category ?? "Miscellaneous",
    subcategory: s.data.subcategory ?? "",
    impact: s.data.impact,
    atRisk: s.data.atRisk,
    studioName: s.data.studioName,
    memberName: s.data.memberName,
    trainerName: s.data.trainerName,
    model: result.model,
  });

  s.step = "review";
  s.insight = insight;
  s.pendingQuestionId = null;

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
  return { state: s, messages, usedAgent: true, userUtterance: utterance };
}

export { buildDraft };
