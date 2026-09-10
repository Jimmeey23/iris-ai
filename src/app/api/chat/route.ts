import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureSeeded } from "@/lib/seed";
import { runChatTurn, type ChatTurnBody } from "@/lib/chat-service";
import { getSessionUser } from "@/lib/session";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Every button and picker in the app speaks one of these short prefixes. */
const OPTION_VALUE = z.string().max(300);

export const composerContextSchema = z
  .object({
    studioId: z.number().int().nullable().optional(),
    studioName: z.string().max(120).optional(),
    memberId: z.number().int().optional(),
    memberName: z.string().max(120).optional(),
    memberContact: z.string().max(200).optional(),
    trainerName: z.string().max(120).optional(),
    classInfo: z.string().max(200).optional(),
    classAt: z.string().max(120).optional(),
    sessionId: z.number().int().positive().optional(),
    membershipRef: z.string().max(200).optional(),
    category: z.string().max(80).optional(),
    subcategory: z.string().max(80).optional(),
    raisedFor: z.string().max(80).optional(),
    occurredAt: z.string().max(120).optional(),
    location: z.string().max(120).optional(),
    impact: z.string().max(80).optional(),
    priority: z.string().max(20).optional(),
    department: z.string().max(80).optional(),
    source: z.string().max(80).optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
    momenceContext: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const chatBodySchema = z.object({
  // Server-generated when absent; legacy ids are accepted but format-checked.
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/).nullable().optional(),
  input: z
    .object({
      value: OPTION_VALUE.optional(),
      text: z.string().max(4000).optional(),
      context: composerContextSchema.optional(),
    })
    .optional(),
  reporter: z
    .object({
      name: z.string().max(120).optional(),
      role: z.string().max(160).optional(),
    })
    .optional(),
  reset: z.boolean().optional(),
});

/** Cryptographically random session ids — transcripts are sensitive. */
function newSessionId(): string {
  return `s_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function prepare(body: ChatTurnBody): Promise<ChatTurnBody> {
  // Identity for the ticket's "reported by" comes from the signed-in session,
  // not from the browser — the client value is only a fallback for unauthenticated
  // environments.
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
  return NextResponse.json(await runChatTurn(body));
}
