import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";
import {
  addMemberFree,
  addMemberWaitlist,
  cancelBooking,
  checkInBooking,
  freezeMembership,
  getMember,
  getMemberBookings,
  getMemberMemberships,
  unfreezeMembership,
  updateCredits,
} from "@/lib/momence";

export const dynamic = "force-dynamic";

type Body = {
  action:
    | "cancel-booking"
    | "check-in"
    | "check-out"
    | "add-free"
    | "add-waitlist"
    | "freeze"
    | "unfreeze"
    | "update-credits"
    | "member-360";
  bookingId?: number;
  sessionId?: number;
  memberId?: number;
  boughtMembershipId?: number;
  credits?: number;
  freezeAt?: string;
  unfreezeAt?: string;
  refund?: boolean;
  notify?: boolean;
  lateCancel?: boolean;
};

const bodySchema = z.object({
  action: z.enum([
    "cancel-booking",
    "check-in",
    "check-out",
    "add-free",
    "add-waitlist",
    "freeze",
    "unfreeze",
    "update-credits",
    "member-360",
  ]),
  bookingId: z.number().optional(),
  sessionId: z.number().optional(),
  memberId: z.number().optional(),
  boughtMembershipId: z.number().optional(),
  credits: z.number().optional(),
  freezeAt: z.string().optional(),
  unfreezeAt: z.string().optional(),
  refund: z.boolean().optional(),
  notify: z.boolean().optional(),
  lateCancel: z.boolean().optional(),
});

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await parseBody(request, bodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }

  try {
    switch (body.action) {
      case "cancel-booking": {
        if (!body.bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
        const r = await cancelBooking(body.bookingId, {
          refund: body.refund ?? true,
          notify: body.notify ?? true,
          lateCancel: body.lateCancel ?? false,
        });
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "check-in":
      case "check-out": {
        if (!body.bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
        const r = await checkInBooking(body.bookingId, body.action === "check-in");
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "add-free": {
        if (!body.sessionId || !body.memberId)
          return NextResponse.json({ error: "sessionId and memberId required" }, { status: 400 });
        const r = await addMemberFree(body.sessionId, body.memberId);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "add-waitlist": {
        if (!body.sessionId || !body.memberId)
          return NextResponse.json({ error: "sessionId and memberId required" }, { status: 400 });
        const r = await addMemberWaitlist(body.sessionId, body.memberId);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "freeze": {
        if (!body.memberId || !body.boughtMembershipId)
          return NextResponse.json({ error: "memberId and boughtMembershipId required" }, { status: 400 });
        const r = await freezeMembership(body.memberId, body.boughtMembershipId, {
          freezeAt: body.freezeAt,
          unfreezeAt: body.unfreezeAt,
        });
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "unfreeze": {
        if (!body.memberId || !body.boughtMembershipId)
          return NextResponse.json({ error: "memberId and boughtMembershipId required" }, { status: 400 });
        const r = await unfreezeMembership(body.memberId, body.boughtMembershipId);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "update-credits": {
        if (!body.memberId || !body.boughtMembershipId || body.credits === undefined)
          return NextResponse.json({ error: "memberId, boughtMembershipId and credits required" }, { status: 400 });
        const r = await updateCredits(body.memberId, body.boughtMembershipId, body.credits);
        return NextResponse.json(r, { status: r.ok ? 200 : 400 });
      }
      case "member-360": {
        if (!body.memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
        const [member, memberships, bookings] = await Promise.all([
          getMember(body.memberId),
          getMemberMemberships(body.memberId),
          getMemberBookings(body.memberId, 12),
        ]);
        return NextResponse.json({ ok: true, member, memberships, bookings });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Momence action failed" },
      { status: 502 },
    );
  }
}
