import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chatSessions } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { getStudios, createTicketFromDraft } from "@/lib/tickets";
import { aiEnrich } from "@/lib/enrich";
import {
  buildDraft,
  createdMessage,
  emptyState,
  handleInput,
  reviewMessage,
  startSession,
  type EngineContext,
  type IntakeState,
} from "@/lib/chat-engine";
import { humanise } from "@/lib/conversation";
import type { ChatMessage, ComposerContext } from "@/lib/types";
import type { SlotId } from "@/lib/dynamic-chat";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

const STEP_SLOT: Record<string, SlotId> = {
  studio: "studio", raised_for: "raisedFor", member: "member", contact: "memberContact",
  trainer: "trainer", class: "classInfo", location: "location", system: "systemAffected",
  membership: "membershipRef", when: "occurredAt", impact: "impact", risk: "atRisk",
  frequency: "frequency", action_taken: "actionTaken", witnesses: "witnesses",
  amount: "amount", notes: "notes",
};

export const dynamic = "force-dynamic";

type Body = {
  sessionId?: string | null;
  input?: { value?: string; text?: string; context?: ComposerContext };
  reporter?: { name?: string; role?: string };
  reset?: boolean;
};

const bodySchema = z.object({
  sessionId: z.string().nullable().optional(),
  input: z
    .object({
      value: z.string().optional(),
      text: z.string().optional(),
      context: z.any().optional(),
    })
    .optional(),
  reporter: z.object({ name: z.string().optional(), role: z.string().optional() }).optional(),
  reset: z.boolean().optional(),
});

async function buildContext(reporter?: { name?: string; role?: string }): Promise<EngineContext> {
  const studios = await getStudios();
  return {
    studios: studios.map((s) => ({ id: s.id, name: s.name, code: s.code, city: s.city, isHq: s.isHq })),
    reporter: {
      name: reporter?.name?.trim() || "Studio Team",
      role: reporter?.role?.trim() || "Internal Team Member",
    },
  };
}

export async function POST(request: Request) {
  await ensureSeeded();
  let body: Body;
  try {
    body = await parseBody(request, bodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }
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

  if (!existing || body.reset) {
    const started = startSession(ctx);
    state = started.state;
    messages = started.messages;
    transcript = messages;
  } else {
    const input = body.input ?? {};
    if (input.text?.trim()) {
      transcript.push({
        id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        content: input.text.trim(),
        createdAt: new Date().toISOString(),
      });
    }

    const result = handleInput(state, input, ctx);
    state = result.state;
    messages = result.messages;

    // Run the richer AI pass when the draft is first shown and when it is approved.
    if (state.step === "review" && !result.createDraft) {
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
      messages = messages.map((m) => (m.kind === "draft" ? reviewMessage(state, ctx, insight) : m));
    }

    // Warm, situation-aware rewrite of the next question when a key is present.
    const slot = STEP_SLOT[state.step];
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
      const draft = buildDraft(state, ctx, insight);
      const ticket = await createTicketFromDraft(draft);
      state = { ...state, step: "created", createdTicketId: ticket.id };
      messages = [
        ...messages,
        createdMessage({
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          assigneeName: ticket.assigneeName,
          assigneeTeam: ticket.assigneeTeam,
          assigneeEmail: ticket.assigneeEmail,
          assignmentReason: ticket.assignmentReason,
          slaDueAt: ticket.slaDueAt ? new Date(ticket.slaDueAt) : null,
          priority: ticket.priority,
        }),
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

  return NextResponse.json({
    sessionId,
    messages,
    step: state.step,
    capture: state.data,
    createdTicketId: state.createdTicketId,
  });
}
