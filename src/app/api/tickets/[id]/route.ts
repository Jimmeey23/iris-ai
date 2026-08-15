import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { addEvent, getTicket, updateTicket } from "@/lib/tickets";
import { assertCanAct, ticketPermissions } from "@/lib/permissions";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getTicket(Number(id));
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

const patchBodySchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  assigneeId: z.number().nullable().optional(),
  resolutionNotes: z.string().optional(),
  comment: z.string().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticketId = Number(id);
  if (!Number.isFinite(ticketId)) {
    return NextResponse.json({ error: "Invalid ticket id" }, { status: 400 });
  }

  let body: z.infer<typeof patchBodySchema>;
  try {
    body = await parseBody(request, patchBodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }
  const actor = { name: body.actor?.trim() || "Internal Team", role: body.actorRole };

  const [current] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const perms = ticketPermissions(current, actor);

  const wantsResolve = body.status === "Resolved" || body.status === "Closed";
  const wantsEdit =
    body.status !== undefined || body.priority !== undefined || body.resolutionNotes !== undefined;
  const wantsReassign = body.assigneeId !== undefined;
  const wantsComment = !!body.comment?.trim();

  const checks: { need: boolean; action: "edit" | "resolve" | "comment" | "reassign" }[] = [
    { need: wantsResolve, action: "resolve" },
    { need: wantsEdit && !wantsResolve, action: "edit" },
    { need: wantsReassign, action: "reassign" },
    { need: wantsComment, action: "comment" },
  ];
  for (const check of checks) {
    if (!check.need) continue;
    const result = assertCanAct(current, actor, check.action);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason, permissions: perms }, { status: 403 });
    }
  }

  if (wantsComment) {
    await addEvent(ticketId, "comment", actor.name, body.comment!.trim());
    if (!current.firstResponseAt) {
      await db.update(tickets).set({ firstResponseAt: new Date() }).where(eq(tickets.id, ticketId));
    }
  }

  if (wantsEdit || wantsReassign) {
    await updateTicket(
      ticketId,
      {
        status: body.status,
        priority: body.priority,
        assigneeId: body.assigneeId,
        resolutionNotes: body.resolutionNotes,
      },
      actor.name,
    );
  }

  const data = await getTicket(ticketId);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...data, permissions: ticketPermissions(data.ticket, actor) });
}
