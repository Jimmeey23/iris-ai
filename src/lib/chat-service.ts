import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chatSessions } from "@/db/schema";
import { getStudios, createTicketBundle } from "@/lib/tickets";
import { aiEnrich } from "@/lib/enrich";
import { runAgentTurn, type AgentTurnResult, type TurnHooks } from "@/lib/agent-session";
import {
  buildDraft,
  createdMessage,
  emptyState,
  reviewMessage,
  startSession,
  type EngineContext,
  type IntakeState,
} from "@/lib/chat-engine";
import { humanise } from "@/lib/conversation";
import { valueToWords } from "@/lib/chat-engine";
import { rememberFact } from "@/lib/memory";
import { embed } from "@/lib/embeddings";
import type { ChatMessage, ComposerContext } from "@/lib/types";
import type { SlotId } from "@/lib/dynamic-chat";

const STEP_SLOT: Record<string, SlotId> = {
  studio: "studio", raised_for: "raisedFor", member: "member", contact: "memberContact",
  trainer: "trainer", class: "classInfo", location: "location", system: "systemAffected",
  membership: "membershipRef", when: "occurredAt", impact: "impact", risk: "atRisk",
  frequency: "frequency", action_taken: "actionTaken", witnesses: "witnesses",
  amount: "amount", notes: "notes",
};

export type ChatTurnBody = {
  sessionId?: string | null;
  input?: { value?: string; text?: string; context?: ComposerContext };
  reporter?: { name?: string; role?: string };
  reset?: boolean;
};

export type ChatTurnResponse = {
  sessionId: string;
  messages: ChatMessage[];
  step: string;
  capture: Record<string, unknown>;
  createdTicketId: number | null;
  mode: "agent" | "deterministic" | "unavailable";
  model?: string;
  degradation?: string;
};

async function buildContext(reporter?: { name?: string; role?: string }): Promise<EngineContext> {
  const studios = await getStudios();
  return {
    studios: studios.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      city: s.city,
      isHq: s.isHq,
      momenceLocationId: s.momenceLocationId,
    })),
    reporter: {
      name: reporter?.name?.trim() || "Studio Team",
      role: reporter?.role?.trim() || "Internal Team Member",
    },
  };
}

/**
 * One turn of the intake conversation, shared by the plain JSON endpoint and
 * the streaming one. `hooks` is how the streaming caller watches the work
 * happen; the JSON caller simply omits it.
 */
export async function runChatTurn(
  body: ChatTurnBody,
  hooks: TurnHooks = {},
): Promise<ChatTurnResponse> {
  const ctx = await buildContext(body.reporter);
  const sessionId =
    body.sessionId ?? `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  let state: IntakeState = emptyState();
  let transcript: ChatMessage[] = [];
  let existing = false;

  if (body.sessionId && !body.reset) {
    const [row] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
    if (row) {
      state = row.state as unknown as IntakeState;
      transcript = (row.transcript as unknown as ChatMessage[]) ?? [];
      existing = true;
    }
  }

  let messages: ChatMessage[] = [];
  let responseMode: ChatTurnResponse["mode"] = "deterministic";
  let responseModel: string | undefined;
  let responseDegradation: string | undefined;

  if (!existing || body.reset) {
    const started = startSession(ctx);
    state = started.state;
    messages = started.messages;
    transcript = messages;
  } else {
    const input = body.input ?? {};
    const pushUser = (content: string) => {
      transcript.push({
        id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      });
    };

    // The LLM agent drives intake whenever a key is configured; the on-device
    // engine stays as the offline fallback and is used automatically if the
    // model call fails.
    const agentInput = { ...(input ?? {}), sessionId: body.sessionId ?? sessionId };
    const result = await runAgentTurn(state, transcript, agentInput, ctx, hooks);
    const agentResult = result as Partial<AgentTurnResult>;
    const usedAgent = agentResult.usedAgent === true;
    responseMode = agentResult.degraded ? "unavailable" : usedAgent ? "agent" : "deterministic";
    responseModel = agentResult.model;
    responseDegradation = agentResult.degraded;

    // Record the reporter's turn in their own words. In agent mode that includes
    // option and picker clicks, which the agent must be able to re-read. In
    // deterministic mode (review/edit mechanics) the button values are spoken
    // too, so the transcript the agent later reads is never missing turns.
    const spoken =
      (usedAgent ? agentResult.userUtterance : undefined) ??
      ((input.value ? valueToWords(input.value, ctx) : "") || input.text?.trim());
    if (spoken) pushUser(spoken);

    if (!usedAgent && input.value === "edit") {
      state = { ...result.state, editCount: (result.state.editCount ?? 0) + 1 };
    } else {
      state = result.state;
    }
    messages = result.messages;

    // Re-enrich only when there is nothing to reuse. The reporter reviews a
    // draft, opens the edit menu, comes back — and the ticket must read exactly
    // the same each time. Re-scoring it on every visit made sentiment, urgency
    // and root cause drift between identical views of the same draft.
    if (!usedAgent && state.step === "review" && !result.createDraft && !state.insight) {
      const d = state.data;
      const insight = await aiEnrich({
        text: [d.rawText ?? "", d.notes ?? ""].filter(Boolean).join(" "),
        category: d.category ?? "Miscellaneous",
        subcategory: d.subcategory ?? "",
        impact: d.impact,
        atRisk: d.atRisk,
        studioName: d.studioName,
        memberName: d.memberName,
        trainerName: d.trainerName,
        classInfo: d.classInfo,
        membershipRef: d.membershipRef,
      });
      state = { ...state, insight };
      messages = messages.map((m) => (m.kind === "draft" ? reviewMessage(state, ctx, insight) : m));
    }

    // Warm, situation-aware rewrite of the next question — legacy path only.
    const slot = usedAgent ? undefined : STEP_SLOT[state.step];
    if (slot && messages.length > 0 && !result.createDraft) {
      const last = messages[messages.length - 1];
      if (last.role === "assistant" && !last.draft && !last.created) {
        const d = state.data;
        const rewritten = await humanise({
          slot,
          defaultPrompt: last.content.split("\n")[0],
          report: `${d.rawText ?? ""} ${d.notes ?? ""}`.trim(),
          category: d.category ?? "",
          subcategory: d.subcategory ?? "",
          known: {
            studio: d.studioName ?? "",
            member: d.memberName ?? "",
            trainer: d.trainerName ?? "",
            class: d.classInfo ?? "",
            when: d.occurredAt ?? "",
            impact: d.impact ?? "",
          },
          asked: state.asked ?? [],
          reporterFirstName: ctx.reporter.name.split(" ")[0],
          remaining: last.remaining ?? 0,
        });
        if (rewritten) {
          const helper = rewritten.helper ? `\n_${rewritten.helper}_` : "";
          const lead = rewritten.ack ? `${rewritten.ack}\n\n` : "";
          messages[messages.length - 1] = { ...last, content: `${lead}${rewritten.prompt}${helper}` };
        }
        state = { ...state, asked: [...(state.asked ?? []), slot] };
      }
    }

    if (result.createDraft) {
      const d = state.data;
      // Reuse the insight the draft was reviewed against so the raised ticket
      // can never disagree with what the reporter approved.
      const insight =
        state.insight ??
        (await aiEnrich({
          text: [d.rawText ?? "", d.notes ?? ""].filter(Boolean).join(" "),
          category: d.category ?? "Miscellaneous",
          subcategory: d.subcategory ?? "",
          impact: d.impact,
          atRisk: d.atRisk,
          studioName: d.studioName,
          memberName: d.memberName,
          trainerName: d.trainerName,
          classInfo: d.classInfo,
          membershipRef: d.membershipRef,
        }));
      const draft = buildDraft(state, ctx, insight);
      const { primary: ticket, children } = await createTicketBundle(draft);
      state = {
        ...state,
        step: "created",
        createdTicketId: ticket.id,
        outcome: "approved",
        approvedAt: new Date().toISOString(),
      };

      // Remember what this studio (and member) just taught us, so future intake
      // starts from history instead of a blank slate. Best-effort, never blocking.
      try {
        if (d.studioId != null) {
          await rememberFact(
            "studio",
            String(d.studioId),
            `${ticket.ticketNumber}: ${draft.title}${draft.rootCause ? ` — ${draft.rootCause}` : ""}`.slice(0, 380),
            ticket.ticketNumber,
          );
        }
        if (d.memberName && !/anonymous|not specified/i.test(d.memberName)) {
          await rememberFact(
            "member",
            d.memberName,
            `${ticket.ticketNumber}: ${draft.title}`.slice(0, 380),
            ticket.ticketNumber,
          );
        }
        // Embed the fresh ticket so it is semantically searchable immediately.
        const vec = await embed([`${draft.title} ${draft.summary} ${draft.rootCause ?? ""} ${draft.subcategory}`]);
        if (vec?.[0]) {
          const { tickets } = await import("@/db/schema");
          const { eq } = await import("drizzle-orm");
          await (await import("@/db")).db.update(tickets).set({ embedding: vec[0] }).where(eq(tickets.id, ticket.id));
        }
      } catch {
        // Memory is an optimisation — the ticket itself is already safe.
      }
      messages = [
        ...messages,
        createdMessage(
          {
            id: ticket.id,
            ticketNumber: ticket.ticketNumber,
            assigneeName: ticket.assigneeName,
            assigneeTeam: ticket.assigneeTeam,
            assigneeEmail: ticket.assigneeEmail,
            assignmentReason: ticket.assignmentReason,
            slaDueAt: ticket.slaDueAt ? new Date(ticket.slaDueAt) : null,
            priority: ticket.priority,
          },
          children.map((c) => ({
            ticketNumber: c.ticketNumber,
            title: c.title,
            assigneeName: c.assigneeName,
          })),
        ),
      ];
    }
    transcript = [...transcript, ...messages];
  }

  await db
    .insert(chatSessions)
    .values({
      id: sessionId,
      state: state as unknown as Record<string, unknown>,
      transcript: transcript as unknown as unknown[],
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: chatSessions.id,
      set: {
        state: state as unknown as Record<string, unknown>,
        transcript: transcript as unknown as unknown[],
        updatedAt: new Date(),
      },
    });

  return {
    sessionId,
    messages,
    step: state.step,
    capture: state.data,
    createdTicketId: state.createdTicketId,
    mode: responseMode,
    model: responseModel,
    degradation: responseDegradation,
  };
}
