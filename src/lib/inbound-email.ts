import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { inboundEmails, studios } from "@/db/schema";
import { classify, extractStudio } from "./ai";
import { aiEnrich, type AiInsight } from "./enrich";
import { priorityFloor } from "./guardrails";
import { suggestOwner } from "./issue-knowledge";
import { CATEGORY_DEPARTMENT } from "./org";
import { createTicketBundle, addEvent } from "./tickets";
import { buildDraftTicket, draftEmailReply } from "./inbound-draft";
import { missingForTicket, type NormalizedEmail } from "./inbound-email-normalize";
import type { TicketDraft } from "./types";

export {
  normalizeFormEmail,
  normalizeWebhookEmail,
  threadKeyOf,
} from "./inbound-email-normalize";
export type { NormalizedEmail } from "./inbound-email-normalize";

/* ------------------------------------------------------------------ */
/* Triage — email in, routed ticket out                                 */
/* ------------------------------------------------------------------ */

export type IngestResult = {
  status: "ticketed" | "duplicate";
  ticketId?: number;
  ticketNumber?: string;
  inboundId: number;
  note?: string;
};

/**
 * Store + triage one inbound email. Idempotent on messageId: a redelivered
 * webhook resolves to the ticket already raised. Triage uses the same
 * classification + enrichment as the chat agent — the LLM pass when a key is
 * configured, the honest on-device NLU when not — and raises the ticket with
 * the usual routing (historic owner hint → department → role → studio → load).
 */
export async function ingestEmail(email: NormalizedEmail, opts: { source?: string } = {}): Promise<IngestResult> {
  const [existing] = await db.select().from(inboundEmails).where(eq(inboundEmails.messageId, email.messageId)).limit(1);
  if (existing) {
    return {
      status: "duplicate",
      inboundId: existing.id,
      ticketId: existing.ticketId ?? undefined,
      note: existing.triageNote ?? undefined,
    };
  }

  const [stored] = await db
    .insert(inboundEmails)
    .values({
      messageId: email.messageId,
      threadKey: email.threadKey,
      fromName: email.fromName,
      fromEmail: email.fromEmail,
      toEmail: email.toEmail,
      subject: email.subject,
      bodyText: email.bodyText,
      receivedAt: email.receivedAt,
      status: "received",
      raw: email.raw,
    })
    .onConflictDoNothing({ target: inboundEmails.messageId })
    .returning();

  if (!stored) {
    // Raced with a concurrent delivery of the same message.
    const [winner] = await db.select().from(inboundEmails).where(eq(inboundEmails.messageId, email.messageId)).limit(1);
    return { status: "duplicate", inboundId: winner?.id ?? 0, ticketId: winner?.ticketId ?? undefined };
  }

  try {
    // The subject is its own sentence — otherwise the on-device title builder
    // fuses subject and body into one run-on line.
    const text = `${email.subject.replace(/[.!?\s]+$/, "")}.\n${email.bodyText}`;
    const top = classify(text, 1)[0];
    const category = top?.category ?? "Miscellaneous";
    const subcategory = top?.subcategory ?? "General";

    const studioList = await db.select().from(studios);
    const studio = extractStudio(text, studioList);
    const { floor } = priorityFloor(text);
    const atRisk = floor === "Critical";
    const impact = /\b(all|several|multiple|everyone|whole studio|every ?member)\b/i.test(text)
      ? "many"
      : floor === "Critical"
        ? "safety"
        : "single";

    const insight: AiInsight = await aiEnrich({
      text,
      category,
      subcategory,
      impact,
      atRisk,
      studioName: studio?.name,
    });

    const missing = missingForTicket(email);
    // The reply is always drafted and always held for a human to approve —
    // nothing is ever auto-sent to the sender.
    const replyDraft = await draftEmailReply(email, insight);
    const draft: TicketDraft = buildDraftTicket({
      email,
      insight,
      category,
      subcategory,
      studio,
      impact,
      atRisk,
      ownerHint: suggestOwner(category, subcategory),
      missing,
      source: opts.source ?? "email",
      replyDraft,
    });

    // createTicketFromDraft already assigns, notifies the assignee and logs
    // the routing reason — no duplicate ping here.
    const bundle = await createTicketBundle(draft);
    const ticket = bundle.primary;

    await addEvent(
      ticket.id,
      "system",
      "Iris",
      `Raised automatically from an inbound email (${email.fromEmail}${email.toEmail ? ` → ${email.toEmail}` : ""}).${
        missing.length ? ` Still unknown: ${missing.join(", ")}.` : ""
      }`,
    );

    await db
      .update(inboundEmails)
      .set({
        status: "ticketed",
        ticketId: ticket.id,
        triageNote: missing.length ? `Triage complete — missing: ${missing.join(", ")}` : "Triage complete",
      })
      .where(eq(inboundEmails.id, stored.id));

    return { status: "ticketed", ticketId: ticket.id, ticketNumber: ticket.ticketNumber, inboundId: stored.id };
  } catch (err) {
    const note = `Triage failed: ${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}`;
    await db.update(inboundEmails).set({ triageNote: note }).where(eq(inboundEmails.id, stored.id));
    throw err;
  }
}

/** Latest inbound emails for the Inbox page. */
export async function listInbound(limit = 60) {
  return db.select().from(inboundEmails).orderBy(desc(inboundEmails.receivedAt)).limit(limit);
}
