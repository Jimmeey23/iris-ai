import { describe, expect, it } from "vitest";
import { assertCanAct, ticketPermissions } from "./permissions";
import type { Ticket } from "@/db/schema";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 1,
    ticketNumber: "P57-1",
    title: "Test",
    summary: "",
    description: "",
    category: "Facilities",
    subcategory: "AC",
    priority: "Medium",
    status: "Open",
    studioId: null,
    studioName: "Not studio specific",
    source: "AI Assistant",
    reportedBy: "Internal Team",
    reportedByRole: "",
    raisedFor: "Noticed by staff",
    memberName: null,
    memberContact: null,
    momenceMemberId: null,
    momenceSessionId: null,
    membershipRef: null,
    trainerName: null,
    classInfo: null,
    classAt: null,
    location: null,
    systemAffected: null,
    occurredAt: null,
    impact: null,
    sentiment: "Neutral",
    emotion: "Informational",
    urgencyScore: 50,
    churnRisk: "Low",
    effort: "Medium",
    rootCause: null,
    suggestedAction: null,
    aiConfidence: 70,
    aiEngine: "Iris NLU",
    department: "Operations",
    tags: [],
    details: {},
    momenceContext: null,
    assigneeId: null,
    assigneeName: null,
    assigneeTeam: null,
    assigneeEmail: null,
    watchers: [],
    slaHours: 72,
    slaReason: "",
    severity: "Moderate",
    firstResponseAt: null,
    assignmentReason: null,
    slaDueAt: null,
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Ticket;
}

describe("ticketPermissions", () => {
  it("grants full access to the assigned owner", () => {
    const ticket = makeTicket({ assigneeId: 5, assigneeName: "Jane Doe" });
    const perms = ticketPermissions(ticket, { name: "jane doe" });
    expect(perms).toMatchObject({ canEdit: true, canResolve: true, canComment: true, canReassign: true });
  });

  it("locks everything for a non-owner, non-override actor on an assigned ticket", () => {
    const ticket = makeTicket({ assigneeId: 5, assigneeName: "Jane Doe", assigneeTeam: "Ops" });
    const perms = ticketPermissions(ticket, { name: "Someone Else" });
    expect(perms).toMatchObject({ canEdit: false, canResolve: false, canComment: false, canReassign: false });
    expect(perms.reason).toContain("Jane Doe");
  });

  it("grants override roles full access regardless of assignment", () => {
    const ticket = makeTicket({ assigneeId: 5, assigneeName: "Jane Doe" });
    const perms = ticketPermissions(ticket, { name: "Someone Else", role: "Ops Manager" });
    expect(perms).toMatchObject({ canEdit: true, canResolve: true, canComment: true, canReassign: true });
  });

  it("lets anyone triage an unassigned ticket but not resolve it", () => {
    const ticket = makeTicket({ assigneeId: null });
    const perms = ticketPermissions(ticket, { name: "Anyone" });
    expect(perms).toMatchObject({ canEdit: true, canResolve: false, canComment: true, canReassign: true });
  });
});

describe("assertCanAct", () => {
  it("blocks resolve action for a locked-out actor", () => {
    const ticket = makeTicket({ assigneeId: 5, assigneeName: "Jane Doe" });
    const result = assertCanAct(ticket, { name: "Someone Else" }, "resolve");
    expect(result.ok).toBe(false);
  });

  it("allows comment action for the assignee", () => {
    const ticket = makeTicket({ assigneeId: 5, assigneeName: "Jane Doe" });
    const result = assertCanAct(ticket, { name: "Jane Doe" }, "comment");
    expect(result.ok).toBe(true);
  });
});
