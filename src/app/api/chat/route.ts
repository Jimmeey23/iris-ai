import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSeeded } from "@/lib/seed";
import { runChatTurn, type ChatTurnBody } from "@/lib/chat-service";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const chatBodySchema = z.object({
  sessionId: z.string().nullable().optional(),
  input: z
    .object({
      value: z.string().optional(),
      text: z.string().optional(),
      context: z.any().optional(),
    })
    .optional(),
  reporter: z.object({ name: z.string().optional(), role: z.string().optional() }).optional(),
  reset: z.boolean().optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  let body: ChatTurnBody;
  try {
    body = await parseBody(request, chatBodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }
  return NextResponse.json(await runChatTurn(body));
}
