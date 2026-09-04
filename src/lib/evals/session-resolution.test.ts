import { describe, expect, it } from "vitest";
import { momenceAvailable } from "../agent-tools";
import { listSessions } from "../momence";

/**
 * End-to-end check of the production intake path: a reporter names a class, and
 * the ticket comes back carrying the real Momence session — not the shorthand
 * they typed, and not a plausible-looking session from another day.
 *
 * Uses whatever is genuinely on today's timetable, so it stays true as the
 * schedule changes. Skipped without a database, a key, or a live Momence.
 */
const READY = !!process.env.DATABASE_URL && (process.env.OPENAI_API_KEY ?? "").startsWith("sk-");

describe.skipIf(!READY)("session resolution", () => {
  it("attaches the real Momence session for a class the reporter names", async () => {
    // Keep the database-backed production service out of the module graph when
    // this credentialed live eval is skipped.
    const { runChatTurn } = await import("../chat-service");
    if (!(await momenceAvailable())) {
      console.warn("Momence not connected — skipping.");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const sessions = await listSessions({
      startAfter: `${today}T00:00:00.000Z`,
      startBefore: `${today}T23:59:59.000Z`,
      pageSize: 40,
    });
    const target = sessions.find((s) => !s.isCancelled);
    if (!target) {
      console.warn("No sessions on today's timetable — skipping.");
      return;
    }

    const when = new Date(target.startsAt).toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    });
    const studio = target.inPersonLocation?.name ?? "Kemps Corner";
    const report = `The ${when} ${target.name} at ${studio} today started late and the room wasn't set up.`;

    const reporter = { name: "Jimmeey Gondaa", role: "Head of Sales" };
    const { sessionId } = await runChatTurn({ reset: true, reporter });
    let turn = await runChatTurn({ sessionId, reporter, input: { text: report } });

    const replies = ["It's sorted now, the class ran in full.", "Nothing else, show me the draft."];
    for (let i = 0; i < 4 && turn.step !== "review"; i++) {
      turn = await runChatTurn({
        sessionId,
        reporter,
        input: { text: replies[Math.min(i, replies.length - 1)] },
      });
    }

    const draft = turn.messages.find((m) => m.kind === "draft")?.draft;
    expect(draft, `never reached a draft (step ${turn.step})`).toBeTruthy();

    const detail = JSON.stringify(
      { report, expected: target.id, got: draft!.momenceSessionId, classInfo: draft!.classInfo },
      null,
      2,
    );
    expect(draft!.momenceSessionId, `session not resolved\n${detail}`).toBe(target.id);
    expect(draft!.classInfo?.toLowerCase(), `classInfo not corrected\n${detail}`).toContain(
      target.name.toLowerCase(),
    );
  }, 300_000);
});
