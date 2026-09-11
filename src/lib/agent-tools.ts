import {
  formatSession,
  getMemberBookings,
  getMemberMemberships,
  getSessionAttendees,
  listSessions,
  momenceStatus,
  searchMembers,
} from "./momence";
import type { MomenceContext } from "./types";
import type { LlmToolDef } from "./llm";

/**
 * Read-only Momence lookups the intake agent may call for itself.
 *
 * Everything here is a query — nothing books, cancels, charges or mutates. The
 * agent gets facts, not the ability to act on the studio's behalf.
 */

export type ToolCall = { tool: string; args?: Record<string, unknown> };
export type ToolResult = { tool: string; args?: Record<string, unknown>; result: string };

const MAX_ROWS = 8;

function istDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

async function runOne(call: ToolCall): Promise<string> {
  const args = call.args ?? {};
  switch (call.tool) {
    case "search_member": {
      const query = String(args.query ?? "").trim();
      if (!query) return "no query given";
      const members = await searchMembers(query, MAX_ROWS);
      if (!members.length) return `no Momence member matches "${query}"`;
      return members
        .map(
          (m) =>
            `id=${m.id} ${m.firstName} ${m.lastName}` +
            `${m.email ? ` <${m.email}>` : ""}${m.phoneNumber ? ` ${m.phoneNumber}` : ""}` +
            `${m.visits?.total != null ? ` · ${m.visits.total} visits` : ""}` +
            `${m.lastSeen ? ` · last seen ${m.lastSeen.slice(0, 10)}` : ""}`,
        )
        .join("\n");
    }

    case "member_context": {
      const memberId = Number(args.memberId);
      if (!Number.isFinite(memberId)) return "memberId must be a number";
      const [memberships, bookings] = await Promise.all([
        getMemberMemberships(memberId).catch(() => []),
        getMemberBookings(memberId, MAX_ROWS).catch(() => []),
      ]);
      const packs = memberships.length
        ? memberships
            .map(
              (m) =>
                `${m.membership?.name ?? m.type}` +
                `${m.eventCreditsLeft != null ? ` (${m.eventCreditsLeft} credits left)` : ""}` +
                `${m.isFrozen ? " [frozen]" : ""}` +
                `${m.endDate ? ` until ${m.endDate.slice(0, 10)}` : ""}`,
            )
            .join("; ")
        : "none on file";
      const recent = bookings.length
        ? bookings
            .slice(0, 5)
            .map(
              (b) =>
                `${b.session ? formatSession(b.session) : "session unknown"}` +
                `${b.cancelledAt ? " [cancelled]" : b.checkedIn ? " [attended]" : " [booked]"}`,
            )
            .join("\n")
        : "no recent bookings";
      return `memberships: ${packs}\nrecent bookings:\n${recent}`;
    }

    case "find_sessions": {
      const query = args.query ? String(args.query) : undefined;
      const date = args.date ? String(args.date) : undefined;
      const locationId = Number.isFinite(Number(args.locationId)) ? Number(args.locationId) : undefined;
      // Never return an unbounded slice of the timetable. Without a date the
      // window is the last week plus tomorrow, so a report about "this morning"
      // can never be matched against a session months away.
      const day = (offsetDays: number) =>
        new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
      const startAfter = date ? `${date}T00:00:00.000Z` : `${day(-7)}T00:00:00.000Z`;
      const startBefore = date ? `${date}T23:59:59.000Z` : `${day(1)}T23:59:59.000Z`;
      let sessions = await listSessions({ query, startAfter, startBefore, locationId, pageSize: 40 });
      // A studio's own shorthand ("BBB", "FIT") rarely matches Momence's class
      // names. Falling back to the day's timetable is far more useful than
      // reporting nothing.
      if (!sessions.length && query) {
        sessions = await listSessions({ startAfter, startBefore, locationId, pageSize: 40 });
      }
      if (!sessions.length) return "no sessions matched";
      return sessions
        .slice(0, 20)
        .map(
          (s) =>
            `id=${s.id} ${s.name} · ${istDate(s.startsAt)}` +
            `${s.teacher ? ` · ${s.teacher.firstName} ${s.teacher.lastName}` : ""}` +
            `${s.inPersonLocation ? ` · ${s.inPersonLocation.name}` : ""}` +
            `${s.bookingCount != null ? ` · ${s.bookingCount}/${s.capacity ?? "?"} booked` : ""}` +
            `${s.isCancelled ? " [CANCELLED]" : ""}`,
        )
        .join("\n");
    }

    case "session_attendees": {
      const sessionId = Number(args.sessionId);
      if (!Number.isFinite(sessionId)) return "sessionId must be a number";
      const attendees = await getSessionAttendees(sessionId);
      if (!attendees.length) return "nobody was booked into that session";
      const active = attendees.filter((a) => !a.cancelled);
      return `${active.length} booked (${attendees.length - active.length} cancelled): ${active
        .slice(0, 12)
        .map((a) => `${a.name || `member ${a.memberId}`}${a.checkedIn ? " ✓" : ""}`)
        .join(", ")}`;
    }

    default:
      return `unknown lookup "${call.tool}"`;
  }
}

/** Run a batch of tool calls, tolerating individual failures. */
export async function runTools(calls: ToolCall[]): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  for (const call of calls.slice(0, 3)) {
    try {
      results.push({ tool: call.tool, args: call.args, result: await runOne(call) });
    } catch (err) {
      results.push({
        tool: call.tool,
        args: call.args,
        result: `lookup failed: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }
  return results;
}

export async function momenceAvailable(): Promise<boolean> {
  try {
    return (await momenceStatus()).connected;
  } catch {
    return false;
  }
}

/**
 * Note: there is deliberately no helper that infers a member or session id from
 * lookup results. Picking the first row of a timetable attaches a plausible but
 * wrong id, which is worse than attaching none — the agent sets
 * `momenceSessionId` / `momenceMemberId` explicitly when it is sure which row
 * is the right one.
 */

/* ------------------------------------------------------------------ */
/* Native function-calling schemas                                     */
/* ------------------------------------------------------------------ */

/**
 * The lookups as real OpenAI functions, so the agent can investigate mid-thought
 * — check a timetable *because* it is unsure — instead of having to declare
 * every lookup it might want before it has seen any results.
 */
export const MOMENCE_TOOL_SCHEMAS: LlmToolDef[] = [
  {
    name: "find_sessions",
    description:
      "Search the real Momence timetable. Use whenever a class is named by time, format or teacher. Omit `query` to pull a whole day's timetable for a location — the right call when several classes are involved.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Class name or teacher. Omit for a full day." },
        date: { type: "string", description: "YYYY-MM-DD, the day the report is about." },
        locationId: { type: "number", description: "Momence location id for the studio." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "session_attendees",
    description:
      "Who was actually booked into a session, and whether they checked in. Use to establish how many members a problem really touched instead of guessing.",
    parameters: {
      type: "object",
      properties: { sessionId: { type: "number" } },
      required: ["sessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_member",
    description:
      "Find a member by name, email or phone. Returns id, contact and visit counts — the exact spelling and contact the ticket should carry.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "member_context",
    description:
      "A member's memberships, credits left and recent bookings. Use when their package or history bears on the issue — a refund, a credit, a repeat complaint.",
    parameters: {
      type: "object",
      properties: { memberId: { type: "number" } },
      required: ["memberId"],
      additionalProperties: false,
    },
  },
];

export const MOMENCE_TOOL_NAMES = new Set(MOMENCE_TOOL_SCHEMAS.map((t) => t.name));

/** Run one named lookup. Never throws — failures come back as readable text. */
export async function runToolByName(
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    return await runOne({ tool, args });
  } catch (err) {
    return `lookup failed: ${err instanceof Error ? err.message : "unknown error"}`;
  }
}
