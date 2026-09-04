import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { tickets, ticketEvents } from "@/db/schema";
import { OPEN_STATUSES, addEvent } from "@/lib/tickets";
import { notifyAssignee } from "@/lib/notify";

export const dynamic = "force-dynamic";

const WARNING_WINDOW_HOURS = 2;

/**
 * SLA sweep: warn assignees before their deadline, alert them once it passes.
 *
 * Nothing schedules this any more — SLA state is shown live on the dashboard
 * instead (see `getDashboardStats`). The endpoint is kept so the push
 * notifications can be switched back on by pointing any external scheduler at
 * it, but it stays shut unless CRON_SECRET is set and presented.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const open = await db
    .select()
    .from(tickets)
    .where(and(inArray(tickets.status, OPEN_STATUSES), isNotNull(tickets.slaDueAt)));

  const now = Date.now();
  let warned = 0;
  let breached = 0;

  for (const ticket of open) {
    if (!ticket.assigneeEmail || !ticket.slaDueAt) continue;
    const dueAt = new Date(ticket.slaDueAt).getTime();
    const hoursRemaining = (dueAt - now) / 3600000;
    const kind = hoursRemaining <= 0 ? "sla_breach" : hoursRemaining <= WARNING_WINDOW_HOURS ? "sla_warning" : null;
    if (!kind) continue;

    const eventType = kind === "sla_breach" ? "whatsapp_breach" : "whatsapp_warning";
    const [existing] = await db
      .select({ id: ticketEvents.id })
      .from(ticketEvents)
      .where(and(eq(ticketEvents.ticketId, ticket.id), eq(ticketEvents.type, eventType)))
      .limit(1);
    if (existing) continue;

    const sent = await notifyAssignee(ticket, kind);
    if (!sent) continue;

    await addEvent(
      ticket.id,
      eventType,
      "Iris SLA monitor",
      kind === "sla_breach"
        ? `SLA breached — WhatsApp reminder sent to ${ticket.assigneeName}.`
        : `SLA due within ${WARNING_WINDOW_HOURS}h — WhatsApp reminder sent to ${ticket.assigneeName}.`,
    );
    if (kind === "sla_breach") breached += 1;
    else warned += 1;
  }

  return NextResponse.json({ ok: true, checked: open.length, warned, breached });
}
