import { ensureSeeded } from "@/lib/seed";
import { runChatTurn, type ChatTurnBody } from "@/lib/chat-service";
import { chatBodySchema } from "../route";
import { getSessionUser } from "@/lib/session";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Server-sent-events version of the intake turn.
 *
 * The reporter sees Iris's reply appear as it is written, plus a short note on
 * what it is doing while it works (checking recent tickets, looking something
 * up in Momence, building the draft). The final `done` event carries exactly
 * the same payload as POST /api/chat, so the client can fall back to that
 * endpoint at any time.
 */
function newSessionId(): string {
  return `s_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function prepare(body: ChatTurnBody): Promise<ChatTurnBody> {
  let reporter = body.reporter;
  try {
    const user = await getSessionUser();
    if (user) {
      const roleLine = [user.jobTitle || user.role, user.studio].filter(Boolean).join(", ");
      reporter = {
        name: user.name || user.email,
        role: roleLine || user.role || "Team",
      };
    }
  } catch {
    // No Supabase session in this environment — keep the supplied reporter.
  }
  return {
    ...body,
    sessionId: body.sessionId ?? newSessionId(),
    reporter,
  };
}

export async function POST(request: Request) {
  const limit = rateLimit(`chat:${clientKey(request)}`, 30, 5 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many turns — take a breath and try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  await ensureSeeded();
  let body: ChatTurnBody;
  try {
    body = await prepare(await parseBody(request, chatBodySchema));
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const result = await runChatTurn(body, {
          onStatus: (status) => send("status", { status }),
          onReplyRestart: () => send("reply_reset", {}),
          onReplyDelta: (text) => send("reply", { text }),
        });
        send("done", result);
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Intake failed unexpectedly.",
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and similar proxies buffer SSE into uselessness without this.
      "X-Accel-Buffering": "no",
    },
  });
}
