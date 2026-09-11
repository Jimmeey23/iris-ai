import { NextResponse } from "next/server";
import { ingestEmail, normalizeFormEmail, normalizeWebhookEmail } from "@/lib/inbound-email";
import {
  fetchInboundMessage,
  mailtrapInboundConfig,
  messageToWebhookPayload,
  parseInboundEvents,
  readSignatureHeader,
  verifyMailtrapSignature,
} from "@/lib/mailtrap-inbound";

export const dynamic = "force-dynamic";

/**
 * Inbound email webhook — the front door that turns a mailbox into tickets.
 *
 * Two ways in:
 *
 * 1. Mailtrap Inbound, recognised by the `Mailtrap-Signature` header. Mailtrap
 *    posts an EVENT, not the email, so each event's message is fetched from the
 *    Messages API before it can be triaged. Authenticated by HMAC over the raw
 *    body — a shared secret in the URL is not involved.
 * 2. Any other provider (Postmark inbound JSON, SendGrid inbound-parse form
 *    posts, or plain JSON with from/to/subject/text), authenticated with
 *    INBOUND_EMAIL_SECRET as a bearer token or ?key=.
 */
function authorized(request: Request, keyFromUrl: string | null): boolean {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return keyFromUrl === secret || request.headers.get("authorization") === `Bearer ${secret}`;
}

type Ingested = { status: string; ticketId?: number };

/**
 * Mailtrap's events carry only ids, so each one costs a fetch. Handled inline
 * because Mailtrap batches a handful at a time, and a webhook that returns
 * before doing the work has no way to report that the work failed.
 */
async function handleMailtrap(rawBody: string, signature: string | null) {
  const cfg = await mailtrapInboundConfig();
  if (!cfg.signingSecret) {
    // Refusing is the only safe answer: without the secret this endpoint would
    // accept anything claiming to be Mailtrap.
    console.error("[inbound] Mailtrap signature present but no signing secret configured");
    return NextResponse.json({ error: "Mailtrap signing secret not configured" }, { status: 503 });
  }
  if (!verifyMailtrapSignature(rawBody, signature, cfg.signingSecret)) {
    // Enough to tell a wrong secret from a mangled body, without printing
    // either the secret or the signature.
    console.error(
      `[inbound] Mailtrap signature mismatch — sig chars=${signature?.trim().length ?? 0}, body bytes=${Buffer.byteLength(rawBody, "utf8")}, secret chars=${cfg.signingSecret.length}`,
    );
    return NextResponse.json({ error: "Bad signature", code: "bad_signature" }, { status: 401 });
  }

  const events = parseInboundEvents(rawBody);
  if (!events.length) {
    // A signed event we do not act on is still a delivered webhook — 200 keeps
    // Mailtrap from retrying it forever.
    return NextResponse.json({ ok: true, handled: 0 }, { status: 200 });
  }

  const results: { messageId: string; status: string; ticketId?: number }[] = [];
  for (const event of events) {
    const inboxId = event.inboxId ?? cfg.inboxId;
    if (!inboxId) {
      results.push({ messageId: event.messageId, status: "no-inbox-id" });
      continue;
    }
    const message = await fetchInboundMessage(inboxId, event.messageId);
    if (!message) {
      results.push({ messageId: event.messageId, status: "fetch-failed" });
      continue;
    }
    const email = normalizeWebhookEmail(messageToWebhookPayload(message));
    if (!email) {
      results.push({ messageId: event.messageId, status: "unreadable" });
      continue;
    }
    if (event.receivedAt) email.receivedAt = event.receivedAt;
    try {
      const result = (await ingestEmail(email, { source: "mailtrap" })) as Ingested;
      results.push({ messageId: event.messageId, status: result.status, ticketId: result.ticketId });
    } catch (err) {
      console.error("[inbound] triage failed:", err instanceof Error ? err.message : err);
      results.push({ messageId: event.messageId, status: "triage-failed" });
    }
  }

  // Any failure returns 5xx so Mailtrap retries the batch. Ingestion is
  // idempotent on message id, so a replay re-delivers nothing.
  const failed = results.some((r) => r.status === "fetch-failed" || r.status === "triage-failed");
  return NextResponse.json({ ok: !failed, results }, { status: failed ? 500 : 200 });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const signature = readSignatureHeader(request.headers);

  // The signature covers the bytes exactly as sent, so the body is read as text
  // once and never re-serialised.
  const rawBody = await request.text().catch(() => "");

  if (signature) return handleMailtrap(rawBody, signature.value);

  // A body that looks like a Mailtrap event but carried no signature we
  // recognise is worth naming precisely: silently failing it as "Unauthorized"
  // sends people hunting for the wrong problem.
  const looksLikeMailtrap = /"event"\s*:\s*"inbound[._]message_received"/.test(rawBody);
  if (looksLikeMailtrap) {
    console.error(
      `[inbound] Mailtrap-shaped payload with no known signature header. Headers seen: ${[...request.headers.keys()].join(", ")}`,
    );
    return NextResponse.json(
      {
        error:
          "Mailtrap event received but no signature header was found. Check the webhook is configured to sign requests.",
        code: "missing_signature",
        headersSeen: [...request.headers.keys()],
      },
      { status: 401 },
    );
  }

  if (!authorized(request, url.searchParams.get("key"))) {
    return NextResponse.json(
      {
        error:
          "Unauthorized. Set INBOUND_EMAIL_SECRET and call with ?key= or a bearer token, or use a signed Mailtrap webhook.",
        code: "unauthorized",
      },
      { status: 401 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  let email = null;
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(rawBody).entries()) form[k] = v;
      email = normalizeFormEmail(form);
    } else {
      email = normalizeWebhookEmail(JSON.parse(rawBody));
    }
  } catch {
    return NextResponse.json({ error: "Unreadable payload" }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: "No email found in payload" }, { status: 422 });
  }

  try {
    const result = (await ingestEmail(email)) as Ingested;
    return NextResponse.json(result, { status: result.status === "duplicate" ? 200 : 201 });
  } catch (err) {
    // The email itself is stored — triage can be retried from the Inbox.
    console.error("[inbound] triage failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Triage failed — email stored for retry" }, { status: 500 });
  }
}
