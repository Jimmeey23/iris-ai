import { NextResponse } from "next/server";
import { ingestEmail, normalizeFormEmail, normalizeWebhookEmail } from "@/lib/inbound-email";

export const dynamic = "force-dynamic";

/**
 * Inbound email webhook — the front door that turns a mailbox into tickets.
 *
 * Provider-agnostic: accepts Postmark inbound JSON, SendGrid inbound-parse
 * form posts, or any JSON with from/to/subject/text fields. Protect with
 * INBOUND_EMAIL_SECRET (bearer token or ?key=) — required in production.
 */
function authorized(request: Request, keyFromUrl: string | null): boolean {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return keyFromUrl === secret || request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!authorized(request, url.searchParams.get("key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let email = null;
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form: Record<string, string> = {};
      for (const [k, v] of (await request.formData()).entries()) {
        if (typeof v === "string") form[k] = v;
      }
      email = normalizeFormEmail(form);
    } else {
      email = normalizeWebhookEmail(await request.json());
    }
  } catch {
    return NextResponse.json({ error: "Unreadable payload" }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: "No email found in payload" }, { status: 422 });
  }

  try {
    const result = await ingestEmail(email);
    return NextResponse.json(result, { status: result.status === "duplicate" ? 200 : 201 });
  } catch (err) {
    // The email itself is stored — triage can be retried from the Inbox.
    console.error("[inbound] triage failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Triage failed — email stored for retry" }, { status: 500 });
  }
}
