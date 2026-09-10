import { NextResponse } from "next/server";
import { z } from "zod";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";
import { ingestEmail, listInbound, threadKeyOf } from "@/lib/inbound-email";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

/** Inbox list for the /inbox page. */
export async function GET() {
  await ensureSeeded();
  const rows = await listInbound();
  return NextResponse.json({ emails: rows });
}

const pasteSchema = z.object({
  fromName: z.string().trim().max(120).optional(),
  fromEmail: z.string().trim().email().max(200),
  subject: z.string().trim().min(1).max(300),
  text: z.string().trim().min(3).max(20000),
});

/** Manual ingest — paste a forwarded email into the Inbox. Same triage pipeline. */
export async function POST(request: Request) {
  let body: z.infer<typeof pasteSchema>;
  try {
    body = await parseBody(request, pasteSchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }

  const subject = body.subject;
  const email = {
    // Stable id: the same paste can never raise two tickets.
    messageId: `manual_${threadKeyOf(body.fromEmail, subject).replace(/[^a-z0-9|]/gi, "_")}`,
    threadKey: threadKeyOf(body.fromEmail, subject),
    fromName: body.fromName ?? null,
    fromEmail: body.fromEmail.toLowerCase(),
    toEmail: null,
    subject,
    bodyText: body.text,
    receivedAt: new Date(),
    raw: { pasted: true },
  };

  try {
    const result = await ingestEmail(email, { source: "email-forwarded" });
    return NextResponse.json(result, { status: result.status === "duplicate" ? 200 : 201 });
  } catch (err) {
    console.error("[inbound] manual triage failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Triage failed — email stored for retry" }, { status: 500 });
  }
}
