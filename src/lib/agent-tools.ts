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

/**
 * Read-only Momence lookups the intake agent may call for itself.
 *
 * Everything here is a query — nothing books, cancels, charges or mutates. The
 * agent gets facts, not the ability to act on the studio's behalf.
 */

export type ToolCall = { tool: string; args?: Record<string, unknown> };
export type ToolResult = { tool: string; args?: Record<string, unknown>; result: string };

/** Description block injected into the prompt so the model knows what exists. */
export const TOOL_CATALOGUE = `AVAILABLE LOOKUPS (read-only, Momence)
Call one only when the answer would genuinely sharpen the ticket AND you cannot get it from the reporter faster. Never call a lookup for something the reporter already told you.
- search_member {"query": "name, email or phone"} → matching members with id, contact and visit counts
- member_context {"memberId": 123} → that member's memberships, credits left and recent bookings
- find_sessions {"query": "class name or teacher", "date": "YYYY-MM-DD"} → real sessions with exact times and teachers
- session_attendees {"sessionId": 123} → who was booked into that session

To use one, return "toolCalls": [{"tool": "...", "args": {...}}] with "nextQuestion": null and "readyForDraft": false. You will be called again with the results and can then continue. At most 3 lookups per report — never repeat a lookup you already made.`;

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
      const startAfter = date ? `${date}T00:00:00.000Z` : undefined;
      const startBefore = date ? `${date}T23:59:59.000Z` : undefined;
      const sessions = await listSessions({ query, startAfter, startBefore, pageSize: 25 });
      if (!sessions.length) return "no sessions matched";
      return sessions
        .slice(0, MAX_ROWS)
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
 * Structured Momence facts worth attaching to the ticket itself, derived from
 * whatever the agent looked up.
 */
export function contextFromResults(results: ToolResult[]): MomenceContext | undefined {
  const memberHit = results.find((r) => r.tool === "search_member" && r.result.startsWith("id="));
  const sessionHit = results.find((r) => r.tool === "find_sessions" && r.result.startsWith("id="));
  if (!memberHit && !sessionHit) return undefined;

  const ctx: MomenceContext = {};
  if (memberHit) {
    const line = memberHit.result.split("\n")[0];
    const id = Number(line.match(/^id=(\d+)/)?.[1]);
    if (Number.isFinite(id)) ctx.memberId = id;
    ctx.memberEmail = line.match(/<([^>]+)>/)?.[1];
  }
  if (sessionHit) {
    const line = sessionHit.result.split("\n")[0];
    const id = Number(line.match(/^id=(\d+)/)?.[1]);
    if (Number.isFinite(id)) ctx.sessionId = id;
    ctx.sessionName = line.split("·")[0].replace(/^id=\d+\s*/, "").trim() || undefined;
  }
  return ctx;
}
