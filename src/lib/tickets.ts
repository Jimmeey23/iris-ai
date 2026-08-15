import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { departments, staff, studios, ticketEvents, tickets } from "@/db/schema";
import type { Ticket, Staff, Studio, Department } from "@/db/schema";
import { SLA_HOURS, type Priority } from "./taxonomy";
import { CATEGORY_DEPARTMENT, CATEGORY_ROLE_PREFERENCE } from "./org";
import type { TicketDraft } from "./types";

export const OPEN_STATUSES = ["Open", "In Progress", "Awaiting Info"];

export async function getStudios(): Promise<Studio[]> {
  return db.select().from(studios).orderBy(asc(studios.id));
}

export async function getStaff(): Promise<Staff[]> {
  return db.select().from(staff).where(eq(staff.isActive, true)).orderBy(asc(staff.name));
}

export async function getDepartments(): Promise<Department[]> {
  return db.select().from(departments).orderBy(asc(departments.name));
}

export type AssignmentResult = { assignee: Staff | null; reason: string; department: string };

/** Routing: category → department → role seniority → studio match → lightest open load. */
export async function pickAssignee(
  category: string,
  studioId: number | null,
  studioName?: string,
): Promise<AssignmentResult> {
  const department = CATEGORY_DEPARTMENT[category] ?? "Operations";
  const people = await getStaff();
  const inDept = people.filter((p) => p.department === department);
  const pool = inDept.length > 0 ? inDept : people;
  if (pool.length === 0) {
    return { assignee: null, reason: "No active owner configured for this queue", department };
  }

  const preferredRoles = CATEGORY_ROLE_PREFERENCE[category] ?? [];
  const byRole = pool.filter((p) => preferredRoles.includes(p.role));
  const shortlist = byRole.length > 0 ? byRole : pool;

  const local = studioId != null ? shortlist.filter((p) => p.studioId === studioId) : [];
  const candidates = local.length > 0 ? local : shortlist;

  const loadRows = await db
    .select({ assigneeId: tickets.assigneeId, count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(inArray(tickets.status, OPEN_STATUSES))
    .groupBy(tickets.assigneeId);
  const load = new Map<number, number>();
  for (const row of loadRows) if (row.assigneeId != null) load.set(row.assigneeId, row.count);

  const chosen = [...candidates].sort(
    (a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id - b.id,
  )[0];

  const scopeBits = [
    `${department} queue owns "${category}"`,
    byRole.length > 0 ? `${chosen.role} is the preferred role` : "no role preference matched",
    local.length > 0 ? `based at ${studioName ?? "this studio"}` : "central coverage",
    `lightest open load (${load.get(chosen.id) ?? 0} active)`,
  ];

  return { assignee: chosen, reason: scopeBits.join(" · "), department };
}

function slaDate(priority: Priority, from = new Date(), hours?: number): Date {
  return new Date(from.getTime() + (hours ?? SLA_HOURS[priority]) * 3600 * 1000);
}

export async function createTicketFromDraft(
  draft: TicketDraft,
  opts: { createdAt?: Date; status?: string } = {},
): Promise<Ticket> {
  const { assignee, reason, department } = await pickAssignee(
    draft.category,
    draft.studioId,
    draft.studioName,
  );
  const createdAt = opts.createdAt ?? new Date();
  const priority = draft.priority;

  const [inserted] = await db
    .insert(tickets)
    .values({
      ticketNumber: `TMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      title: draft.title,
      summary: draft.summary,
      description: draft.description,
      category: draft.category,
      subcategory: draft.subcategory,
      priority,
      status: opts.status ?? "Open",
      studioId: draft.studioId,
      studioName: draft.studioName,
      source: draft.source,
      reportedBy: draft.reportedBy,
      reportedByRole: draft.reportedByRole,
      raisedFor: draft.raisedFor,
      memberName: draft.memberName ?? null,
      memberContact: draft.memberContact ?? null,
      momenceMemberId: draft.momenceMemberId ?? null,
      momenceSessionId: draft.momenceSessionId ?? null,
      membershipRef: draft.membershipRef ?? null,
      trainerName: draft.trainerName ?? null,
      classInfo: draft.classInfo ?? null,
      classAt: draft.classAt ?? null,
      location: draft.location ?? null,
      systemAffected: draft.systemAffected ?? null,
      occurredAt: draft.occurredAt ?? null,
      impact: draft.impact ?? null,
      sentiment: draft.sentiment,
      emotion: draft.emotion,
      urgencyScore: draft.urgencyScore,
      churnRisk: draft.churnRisk,
      effort: draft.effort,
      rootCause: draft.rootCause,
      suggestedAction: draft.suggestedAction,
      aiConfidence: draft.aiConfidence,
      aiEngine: draft.aiEngine,
      severity: draft.severity,
      slaHours: Math.round(draft.slaResolveHours),
      slaReason: draft.slaReason,
      department: draft.department || department,
      tags: draft.tags,
      details: draft.details,
      momenceContext: draft.momenceContext ?? null,
      assigneeId: assignee?.id ?? null,
      assigneeName: assignee?.name ?? null,
      assigneeTeam: assignee?.department ?? department,
      assigneeEmail: assignee?.email ?? null,
      assignmentReason: reason,
      slaDueAt: slaDate(priority, createdAt, draft.slaResolveHours),
      createdAt,
      updatedAt: createdAt,
    })
    .returning();

  const ticketNumber = `P57-${String(10000 + inserted.id)}`;
  const [ticket] = await db
    .update(tickets)
    .set({ ticketNumber })
    .where(eq(tickets.id, inserted.id))
    .returning();

  await db.insert(ticketEvents).values([
    {
      ticketId: ticket.id,
      type: "created",
      actor: draft.reportedBy,
      message: `Ticket raised via ${draft.source} and classified as ${draft.category} › ${draft.subcategory}.`,
      meta: { priority, sentiment: draft.sentiment },
      createdAt,
    },
    {
      ticketId: ticket.id,
      type: "ai",
      actor: draft.aiEngine,
      message: `AI read: ${draft.emotion.toLowerCase()} tone, urgency ${draft.urgencyScore}/100, churn risk ${draft.churnRisk.toLowerCase()}, ${draft.effort.toLowerCase()} effort. Severity ${draft.severity} → respond ${draft.slaRespondHours}h / resolve ${draft.slaResolveHours}h under the "${draft.slaPolicy}" policy. ${draft.rootCause}`,
      meta: { confidence: String(draft.aiConfidence) },
      createdAt: new Date(createdAt.getTime() + 30),
    },
    {
      ticketId: ticket.id,
      type: "assignment",
      actor: "Iris routing engine",
      message: assignee
        ? `Auto-assigned to ${assignee.name} — ${assignee.role}, ${assignee.department}. ${reason}`
        : "No owner configured for this queue; left unassigned for triage.",
      meta: { assignee: assignee?.name ?? "unassigned" },
      createdAt: new Date(createdAt.getTime() + 60),
    },
  ]);

  return ticket;
}

export type TicketFilters = {
  q?: string;
  status?: string;
  category?: string;
  priority?: string;
  studioId?: number;
  assigneeId?: number;
  department?: string;
  limit?: number;
};

export async function listTickets(filters: TicketFilters = {}): Promise<Ticket[]> {
  const conditions: SQL[] = [];
  if (filters.q) {
    const term = `%${filters.q}%`;
    const clause = or(
      ilike(tickets.title, term),
      ilike(tickets.summary, term),
      ilike(tickets.description, term),
      ilike(tickets.ticketNumber, term),
      ilike(tickets.memberName, term),
      ilike(tickets.subcategory, term),
    );
    if (clause) conditions.push(clause);
  }
  if (filters.status && filters.status !== "all") {
    if (filters.status === "open") conditions.push(inArray(tickets.status, OPEN_STATUSES));
    else conditions.push(eq(tickets.status, filters.status));
  }
  if (filters.category && filters.category !== "all") conditions.push(eq(tickets.category, filters.category));
  if (filters.priority && filters.priority !== "all") conditions.push(eq(tickets.priority, filters.priority));
  if (filters.department && filters.department !== "all") conditions.push(eq(tickets.department, filters.department));
  if (filters.studioId) conditions.push(eq(tickets.studioId, filters.studioId));
  if (filters.assigneeId) conditions.push(eq(tickets.assigneeId, filters.assigneeId));

  const base = db.select().from(tickets);
  const query = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return query.orderBy(desc(tickets.createdAt)).limit(filters.limit ?? 200);
}

export async function getTicket(id: number) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!ticket) return null;
  const events = await db
    .select()
    .from(ticketEvents)
    .where(eq(ticketEvents.ticketId, id))
    .orderBy(asc(ticketEvents.createdAt), asc(ticketEvents.id));
  return { ticket, events };
}

export type DashboardStats = {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  critical: number;
  breached: number;
  avgResolutionHours: number;
  resolvedThisWeek: number;
  newToday: number;
  highChurn: number;
  byCategory: { category: string; count: number; open: number }[];
  byStudio: { studio: string; count: number; open: number }[];
  byPriority: { priority: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byDepartment: { department: string; count: number; open: number }[];
  byDay: { day: string; count: number; resolved: number }[];
  topSubcategories: { subcategory: string; category: string; count: number }[];
  workload: { assignee: string; team: string; open: number }[];
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const rows = await db.select().from(tickets);
  const now = Date.now();
  const openRows = rows.filter((t) => OPEN_STATUSES.includes(t.status));
  const resolvedRows = rows.filter((t) => t.status === "Resolved" || t.status === "Closed");

  const durations = resolvedRows
    .filter((t) => t.resolvedAt)
    .map((t) => (new Date(t.resolvedAt as Date).getTime() - new Date(t.createdAt).getTime()) / 3600000);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const group = (items: Ticket[], key: (t: Ticket) => string) => {
    const map = new Map<string, { count: number; open: number }>();
    for (const item of items) {
      const k = key(item);
      const entry = map.get(k) ?? { count: 0, open: 0 };
      entry.count += 1;
      if (OPEN_STATUSES.includes(item.status)) entry.open += 1;
      map.set(k, entry);
    }
    return map;
  };

  const byCategory = [...group(rows, (t) => t.category).entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.count - a.count);
  const byStudio = [...group(rows, (t) => t.studioName).entries()]
    .map(([studio, v]) => ({ studio, ...v }))
    .sort((a, b) => b.count - a.count);
  const byDepartment = [...group(rows, (t) => t.department).entries()]
    .map(([department, v]) => ({ department, ...v }))
    .sort((a, b) => b.count - a.count);
  const byPriority = ["Critical", "High", "Medium", "Low"].map((priority) => ({
    priority,
    count: rows.filter((t) => t.priority === priority).length,
  }));
  const byStatus = ["Open", "In Progress", "Awaiting Info", "Resolved", "Closed"].map((status) => ({
    status,
    count: rows.filter((t) => t.status === status).length,
  }));

  const byDay: { day: string; count: number; resolved: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const key = new Date(now - i * 86400000).toISOString().slice(0, 10);
    byDay.push({
      day: key,
      count: rows.filter((t) => new Date(t.createdAt).toISOString().slice(0, 10) === key).length,
      resolved: rows.filter(
        (t) => t.resolvedAt && new Date(t.resolvedAt).toISOString().slice(0, 10) === key,
      ).length,
    });
  }

  const subMap = new Map<string, { category: string; count: number }>();
  for (const t of rows) {
    const entry = subMap.get(t.subcategory) ?? { category: t.category, count: 0 };
    entry.count += 1;
    subMap.set(t.subcategory, entry);
  }
  const topSubcategories = [...subMap.entries()]
    .map(([subcategory, v]) => ({ subcategory, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const workloadMap = new Map<string, { team: string; open: number }>();
  for (const t of openRows) {
    const name = t.assigneeName ?? "Unassigned";
    const entry = workloadMap.get(name) ?? { team: t.assigneeTeam ?? "Triage", open: 0 };
    entry.open += 1;
    workloadMap.set(name, entry);
  }
  const workload = [...workloadMap.entries()]
    .map(([assignee, v]) => ({ assignee, ...v }))
    .sort((a, b) => b.open - a.open)
    .slice(0, 8);

  const todayKey = new Date(now).toISOString().slice(0, 10);

  return {
    total: rows.length,
    open: openRows.length,
    inProgress: rows.filter((t) => t.status === "In Progress").length,
    resolved: resolvedRows.length,
    critical: openRows.filter((t) => t.priority === "Critical").length,
    breached: openRows.filter((t) => t.slaDueAt && new Date(t.slaDueAt).getTime() < now).length,
    avgResolutionHours: Math.round(avg * 10) / 10,
    resolvedThisWeek: resolvedRows.filter(
      (t) => t.resolvedAt && now - new Date(t.resolvedAt).getTime() < 7 * 86400000,
    ).length,
    newToday: rows.filter((t) => new Date(t.createdAt).toISOString().slice(0, 10) === todayKey).length,
    highChurn: openRows.filter((t) => t.churnRisk === "High").length,
    byCategory,
    byStudio,
    byPriority,
    byStatus,
    byDepartment,
    byDay,
    topSubcategories,
    workload,
  };
}

export async function addEvent(
  ticketId: number,
  type: string,
  actor: string,
  message: string,
  meta: Record<string, string> = {},
) {
  await db.insert(ticketEvents).values({ ticketId, type, actor, message, meta });
}

export async function updateTicket(
  id: number,
  patch: Partial<{
    status: string;
    priority: string;
    assigneeId: number | null;
    resolutionNotes: string;
  }>,
  actor: string,
): Promise<Ticket | null> {
  const [current] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
  if (!current) return null;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const notes: { type: string; message: string }[] = [];

  if (patch.status && patch.status !== current.status) {
    updates.status = patch.status;
    notes.push({ type: "status", message: `Status changed from ${current.status} to ${patch.status}.` });
    updates.resolvedAt = patch.status === "Resolved" || patch.status === "Closed" ? new Date() : null;
  }
  if (patch.priority && patch.priority !== current.priority) {
    updates.priority = patch.priority;
    updates.slaDueAt = slaDate(patch.priority as Priority, new Date(current.createdAt));
    notes.push({
      type: "priority",
      message: `Priority changed from ${current.priority} to ${patch.priority}; SLA recalculated.`,
    });
  }
  if (patch.assigneeId !== undefined && patch.assigneeId !== current.assigneeId) {
    if (patch.assigneeId === null) {
      updates.assigneeId = null;
      updates.assigneeName = null;
      updates.assigneeEmail = null;
      notes.push({ type: "assignment", message: "Ticket unassigned." });
    } else {
      const [person] = await db.select().from(staff).where(eq(staff.id, patch.assigneeId)).limit(1);
      if (person) {
        updates.assigneeId = person.id;
        updates.assigneeName = person.name;
        updates.assigneeTeam = person.department;
        updates.assigneeEmail = person.email;
        updates.assignmentReason = `Manually reassigned by ${actor}`;
        notes.push({
          type: "assignment",
          message: `Reassigned to ${person.name} (${person.role}, ${person.department}).`,
        });
      }
    }
  }
  if (patch.resolutionNotes !== undefined) updates.resolutionNotes = patch.resolutionNotes;

  const [updated] = await db.update(tickets).set(updates).where(eq(tickets.id, id)).returning();
  for (const note of notes) await addEvent(id, note.type, actor, note.message);
  return updated;
}
