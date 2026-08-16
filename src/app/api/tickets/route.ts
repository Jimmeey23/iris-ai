import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSeeded } from "@/lib/seed";
import { createTicketFromDraft, listTickets } from "@/lib/tickets";
import { aiEnrich } from "@/lib/enrich";
import { CATEGORY_DEPARTMENT } from "@/lib/org";
import { getSessionUser } from "@/lib/session";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";
import type { TicketDraft } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const actor = await getSessionUser();
  const tickets = await listTickets({
    q: searchParams.get("q") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    priority: searchParams.get("priority") ?? undefined,
    department: searchParams.get("department") ?? undefined,
    studioId: searchParams.get("studioId") ? Number(searchParams.get("studioId")) : undefined,
    assigneeId: searchParams.get("assigneeId") ? Number(searchParams.get("assigneeId")) : undefined,
    actor: actor ? { name: actor.name, role: actor.role, department: actor.department } : undefined,
  });
  return NextResponse.json({ tickets });
}

const momenceContextSchema = z
  .object({
    memberId: z.number().optional(),
    memberEmail: z.string().optional(),
    memberPhone: z.string().optional(),
    memberSince: z.string().optional(),
    memberVisits: z.number().optional(),
    lastVisit: z.string().optional(),
    sessionId: z.number().optional(),
    sessionName: z.string().optional(),
    sessionStart: z.string().optional(),
    sessionTeacher: z.string().optional(),
    sessionLocation: z.string().optional(),
    memberships: z.array(z.string()).optional(),
    creditsLeft: z.number().nullable().optional(),
  })
  .partial();

const manualBodySchema = z.object({
  category: z.string().min(1),
  subcategory: z.string().min(1),
  title: z.string().optional(),
  description: z.string().min(1),
  studioId: z.number().nullable().optional(),
  studioName: z.string().optional(),
  priority: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
  raisedFor: z.string().optional(),
  memberName: z.string().optional(),
  memberContact: z.string().optional(),
  momenceMemberId: z.number().optional(),
  momenceSessionId: z.number().optional(),
  membershipRef: z.string().optional(),
  trainerName: z.string().optional(),
  classInfo: z.string().optional(),
  classAt: z.string().optional(),
  location: z.string().optional(),
  systemAffected: z.string().optional(),
  occurredAt: z.string().optional(),
  impact: z.string().optional(),
  reportedBy: z.string().optional(),
  reportedByRole: z.string().optional(),
  source: z.string().optional(),
  momenceContext: momenceContextSchema.optional(),
  details: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();

  let body: z.infer<typeof manualBodySchema>;
  try {
    body = await parseBody(request, manualBodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }

  const studioName = body.studioName ?? "Not studio specific";
  let ai;
  try {
    ai = await aiEnrich({
      text: body.description,
      category: body.category,
      subcategory: body.subcategory,
      impact: body.impact,
      studioName,
      memberName: body.memberName,
      trainerName: body.trainerName,
      classInfo: body.classInfo,
      membershipRef: body.membershipRef,
    });
  } catch (err) {
    console.error("aiEnrich failed", err);
    return NextResponse.json({ error: "Failed to enrich ticket with AI" }, { status: 502 });
  }

  const details: Record<string, string> = { ...(body.details ?? {}) };
  if (body.trainerName) details["Trainer"] = body.trainerName;
  if (body.classInfo) details["Class / format"] = body.classInfo;
  if (body.classAt) details["Class date & time"] = body.classAt;
  if (body.location) details["Location"] = body.location;
  if (body.systemAffected) details["System affected"] = body.systemAffected;
  if (body.membershipRef) details["Membership"] = body.membershipRef;
  if (body.occurredAt) details["When"] = body.occurredAt;

  const draft: TicketDraft = {
    category: ai.category ?? body.category,
    subcategory: ai.subcategory ?? body.subcategory,
    title: body.title?.trim() || ai.title,
    summary: ai.summary,
    description: body.description.trim(),
    priority: body.priority ?? ai.priority,
    studioId: body.studioId ?? null,
    studioName,
    reportedBy: body.reportedBy ?? "Internal Team",
    reportedByRole: body.reportedByRole ?? "",
    raisedFor: body.raisedFor ?? "Noticed by staff",
    memberName: body.memberName,
    memberContact: body.memberContact,
    momenceMemberId: body.momenceMemberId,
    momenceSessionId: body.momenceSessionId,
    membershipRef: body.membershipRef,
    trainerName: body.trainerName,
    classInfo: body.classInfo,
    classAt: body.classAt,
    location: body.location,
    systemAffected: body.systemAffected,
    occurredAt: body.occurredAt,
    impact: body.impact,
    sentiment: ai.sentiment,
    emotion: ai.emotion,
    urgencyScore: ai.urgencyScore,
    churnRisk: ai.churnRisk,
    effort: ai.effort,
    rootCause: ai.rootCause,
    suggestedAction: ai.suggestedAction,
    aiConfidence: ai.confidence,
    aiEngine: ai.engine,
    severity: ai.severity,
    slaRespondHours: ai.slaRespondHours,
    slaResolveHours: ai.slaResolveHours,
    slaPolicy: ai.slaPolicy,
    slaReason: ai.slaReason,
    department: CATEGORY_DEPARTMENT[body.category] ?? "Operations",
    tags: ai.tags,
    details,
    momenceContext: body.momenceContext,
    source: body.source ?? "Quick template",
    priorityReason: ai.priorityReason,
  };

  try {
    const ticket = await createTicketFromDraft(draft);
    return NextResponse.json({ ticket });
  } catch (err) {
    console.error("createTicketFromDraft failed", err);
    return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 });
  }
}
