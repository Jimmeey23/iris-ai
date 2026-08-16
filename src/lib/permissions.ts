import type { Ticket } from "@/db/schema";

/** Access-control role from Supabase Auth + user_accounts (separate from job title). */
export type AccessRole = "admin" | "manager" | "executive";

export function canManageSettings(role: AccessRole | undefined): boolean {
  return role === "admin";
}

export function canDeleteTickets(role: AccessRole | undefined): boolean {
  return role === "admin";
}

export function canEditReviews(role: AccessRole | undefined): boolean {
  return role === "admin";
}

/** Roles that can always act on any ticket regardless of assignment. */
export const OVERRIDE_ROLES = [
  "Owner",
  "Chief Operations Officer",
  "Ops Manager",
  "Regional Head of Ops - South",
];

export type Actor = { name: string; role?: string; email?: string | null };

export type TicketPermissions = {
  canEdit: boolean;
  canResolve: boolean;
  canComment: boolean;
  canReassign: boolean;
  reason: string;
};

/**
 * Only the assigned owner may progress a ticket. Leadership roles retain an
 * override so nothing can get stuck, and unassigned tickets stay open to triage.
 */
export function ticketPermissions(ticket: Ticket, actor: Actor): TicketPermissions {
  const isAssignee =
    !!ticket.assigneeName && ticket.assigneeName.toLowerCase() === actor.name.toLowerCase();
  const isOverride = !!actor.role && OVERRIDE_ROLES.includes(actor.role);
  const unassigned = !ticket.assigneeId;

  if (isAssignee) {
    return {
      canEdit: true,
      canResolve: true,
      canComment: true,
      canReassign: true,
      reason: "You are the assigned owner of this ticket.",
    };
  }
  if (isOverride) {
    return {
      canEdit: true,
      canResolve: true,
      canComment: true,
      canReassign: true,
      reason: `${actor.role} override — you can act on any ticket.`,
    };
  }
  if (unassigned) {
    return {
      canEdit: true,
      canResolve: false,
      canComment: true,
      canReassign: true,
      reason: "Unassigned ticket — anyone can triage and claim it, but only the owner can resolve.",
    };
  }
  return {
    canEdit: false,
    canResolve: false,
    canComment: false,
    canReassign: false,
    reason: `Locked — only ${ticket.assigneeName} (${ticket.assigneeTeam}) can update or close this ticket.`,
  };
}

export function assertCanAct(
  ticket: Ticket,
  actor: Actor,
  action: "edit" | "resolve" | "comment" | "reassign",
): { ok: boolean; reason: string } {
  const p = ticketPermissions(ticket, actor);
  const map = { edit: p.canEdit, resolve: p.canResolve, comment: p.canComment, reassign: p.canReassign };
  return { ok: map[action], reason: p.reason };
}
