import { NextResponse } from "next/server";
import {
  getSessionAttendees,
  getSession,
  formatSession,
  getDirectory,
  getMemberBookings,
  getMemberMemberships,
  listSessions,
  momenceStatus,
  searchMembers,
} from "@/lib/momence";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resource = searchParams.get("resource") ?? "status";
  const q = searchParams.get("q") ?? "";

  try {
    switch (resource) {
      case "status":
        return NextResponse.json(await momenceStatus());

      case "members": {
        const members = await searchMembers(q, 8);
        return NextResponse.json({
          members: members.map((m) => ({
            id: m.id,
            name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim(),
            email: m.email,
            phone: m.phoneNumber,
            visits: m.visits?.total ?? 0,
            lastSeen: m.lastSeen,
            firstSeen: m.firstSeen,
            tags: (m.customerTags ?? []).map((t) => t.name),
          })),
        });
      }

      case "member-detail": {
        const memberId = Number(searchParams.get("memberId"));
        if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
        const [memberships, bookings] = await Promise.all([
          getMemberMemberships(memberId),
          getMemberBookings(memberId, 6),
        ]);
        return NextResponse.json({
          memberships: memberships.map((m) => ({
            id: m.id,
            name: m.membership?.name ?? m.type,
            type: m.type,
            creditsLeft: m.eventCreditsLeft,
            creditsTotal: m.eventCreditsTotal,
            isFrozen: m.isFrozen,
            endDate: m.endDate,
          })),
          bookings: bookings
            .filter((b) => b.session)
            .map((b) => ({
              id: b.session!.id,
              label: formatSession(b.session!),
              name: b.session!.name,
              startsAt: b.session!.startsAt,
              teacher: b.session!.teacher
                ? `${b.session!.teacher.firstName} ${b.session!.teacher.lastName}`.trim()
                : null,
              location: b.session!.inPersonLocation?.name ?? null,
              checkedIn: b.checkedIn,
            })),
        });
      }

      case "sessions": {
        const days = Number(searchParams.get("days") ?? 10);
        const now = Date.now();
        const sessions = await listSessions({
          query: q,
          startAfter: new Date(now - days * 86400000).toISOString(),
          startBefore: new Date(now + 3 * 86400000).toISOString(),
          pageSize: 200,
        });
        return NextResponse.json({
          sessions: sessions
            .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
            .slice(0, 25)
            .map((s) => ({
              id: s.id,
              label: formatSession(s),
              name: s.name,
              startsAt: s.startsAt,
              teacher: s.teacher ? `${s.teacher.firstName} ${s.teacher.lastName}`.trim() : null,
              location: s.inPersonLocation?.name ?? null,
              capacity: s.capacity,
              booked: s.bookingCount,
            })),
        });
      }

      case "private-sessions": {
        const days = Number(searchParams.get("days") ?? 120);
        const now = Date.now();
        const sessions = await listSessions({
          query: q,
          startAfter: new Date(now - days * 86400000).toISOString(),
          startBefore: new Date(now + 60 * 86400000).toISOString(),
          types: ["private", "special-event", "special-event-new"],
          pageSize: 200,
        });
        return NextResponse.json({
          sessions: sessions
            .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
            .slice(0, 40)
            .map((s) => ({
              id: s.id,
              label: formatSession(s),
              name: s.name,
              type: s.type,
              startsAt: s.startsAt,
              teacher: s.teacher ? `${s.teacher.firstName} ${s.teacher.lastName}`.trim() : null,
              location: s.inPersonLocation?.name ?? null,
              capacity: s.capacity,
              booked: s.bookingCount,
            })),
        });
      }

      case "attendees": {
        // One incident can span several classes, so the roster is the union of
        // the chosen sessions with each row tagged by the session it came from.
        const ids = (searchParams.get("sessionIds") ?? searchParams.get("sessionId") ?? "")
          .split(",")
          .map((v) => Number(v.trim()))
          .filter((v) => Number.isFinite(v) && v > 0)
          .slice(0, 10);
        if (!ids.length) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

        const sessions = await Promise.all(
          ids.map(async (sessionId) => {
            const [rows, session] = await Promise.all([
              getSessionAttendees(sessionId).catch(() => []),
              getSession(sessionId).catch(() => null),
            ]);
            const sessionName = session?.name ?? `Session ${sessionId}`;
            return rows.map((a) => ({ ...a, sessionId, sessionName }));
          }),
        );
        return NextResponse.json({ attendees: sessions.flat() });
      }

      case "directory": {
        const dir = await getDirectory();
        return NextResponse.json(dir);
      }

      default:
        return NextResponse.json({ error: "unknown resource" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Momence request failed" }, { status: 502 });
  }
}
