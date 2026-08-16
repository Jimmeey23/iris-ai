import type { Ticket } from "@/db/schema";
import { sendTemplateByName } from "./respond-templates";

function formatDue(date: Date | null): string {
  if (!date) return "no due date set";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type NotifyKind = "assigned" | "reassigned" | "sla_warning" | "sla_breach";

const TEMPLATE_NAMES: Record<NotifyKind, string> = {
  assigned: "iris_ticket_assigned",
  reassigned: "iris_ticket_assigned",
  sla_warning: "iris_sla_warning",
  sla_breach: "iris_sla_breach",
};

/**
 * Best-effort WhatsApp ping to a ticket's assignee. Never throws — a failed
 * send must not block the ticket action. Returns whether the send actually
 * succeeded, so callers that dedup reminders (the SLA cron) can retry on the
 * next pass instead of permanently marking a silently-failed send as done.
 */
export async function notifyAssignee(ticket: Ticket, kind: NotifyKind): Promise<boolean> {
  if (!ticket.assigneeEmail) return false;

  try {
    const dueAt = ticket.slaDueAt ? new Date(ticket.slaDueAt) : null;
    const bodyValues =
      kind === "assigned" || kind === "reassigned"
        ? [ticket.assigneeName ?? "there", ticket.ticketNumber, ticket.title, ticket.priority, formatDue(dueAt)]
        : [ticket.ticketNumber, ticket.title, formatDue(dueAt)];

    const result = await sendTemplateByName(ticket.assigneeEmail, TEMPLATE_NAMES[kind], bodyValues);
    return result.ok;
  } catch {
    return false;
  }
}
