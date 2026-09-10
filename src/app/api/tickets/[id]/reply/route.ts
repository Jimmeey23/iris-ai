import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";
import { addEvent, getTicket } from "@/lib/tickets";
import { sendEmail } from "@/lib/integrations";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  text: z.string().trim().min(3).max(8000),
  to: z.string().trim().email().max(200).optional(),
  actor: z.string().trim().min(1).max(120),
});

/**
 * Send the approved reply for an email-sourced ticket. The draft lives in
 * ticket details; nothing is sent until a human presses send here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }

  const { id } = await params;
  const ticketId = Number(id);
  if (!Number.isFinite(ticketId)) return NextResponse.json({ error: "Bad ticket id" }, { status: 400 });
  const data = await getTicket(ticketId);
  if (!data) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const ticket = data.ticket;
  if (ticket.source !== "email" && ticket.source !== "email-forwarded") {
    return NextResponse.json({ error: "This ticket did not arrive by email" }, { status: 422 });
  }

  // The stored "From" is a display form ("Meera Shah <meera@x>") — extract the
  // bare address for the mail provider.
  const rawTo = body.to || ticket.details?.["From"] || "";
  const address = rawTo.match(/[^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+/)?.[0];
  if (!address) {
    return NextResponse.json({ error: "No sender address on this ticket" }, { status: 422 });
  }
  const to = address;

  const paragraphs = body.text.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`);
  const result = await sendEmail({
    to,
    subject: `Re: ${ticket.details?.["Email subject"] ?? ticket.title}`,
    html: `<div style="font-family:Outfit,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#222">${paragraphs.join("")}</div>`,
    text: body.text,
    category: "iris-ticket-reply",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.detail }, { status: 502 });
  }

  const details = { ...(ticket.details ?? {}) };
  details["Reply status"] = `sent to ${to}`;
  details["Reply sent at"] = new Date().toISOString();
  await db
    .update(tickets)
    .set({
      details,
      firstResponseAt: ticket.firstResponseAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticket.id));
  await addEvent(
    ticket.id,
    "reply",
    body.actor,
    `Reply sent to ${to}:\n\n${body.text.slice(0, 800)}`,
  );

  return NextResponse.json({ ok: true, detail: result.detail });
}
