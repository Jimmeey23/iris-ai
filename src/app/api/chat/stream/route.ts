import { ensureSeeded } from "@/lib/seed";
import { runChatTurn, type ChatTurnBody } from "@/lib/chat-service";
import { chatBodySchema } from "../route";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

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
export async function POST(request: Request) {
  await ensureSeeded();
  let body: ChatTurnBody;
  try {
    body = await parseBody(request, chatBodySchema);
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
