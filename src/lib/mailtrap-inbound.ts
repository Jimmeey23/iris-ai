import { createHmac, timingSafeEqual } from "node:crypto";
import { getSettings } from "./settings";

/**
 * Mailtrap Inbound → tickets.
 *
 * Mailtrap's inbound webhook is a NOTIFICATION, not the email. It posts a small
 * event saying "message <id> arrived in inbox <id>"; the body, sender and
 * subject have to be fetched from the Messages API afterwards. That is the one
 * thing that makes this integration different from Postmark or SendGrid
 * inbound-parse, which post the whole message.
 */

export type MailtrapInboundEvent = {
  event: string;
  /** Mailtrap's own id for the message, used to fetch its body. */
  messageId: string;
  inboxId: number | null;
  /** Stable per delivery, so a retried webhook can be recognised. */
  eventId: string | null;
  /** Present on the event itself — a usable fallback if the fetch fails. */
  from: string | null;
  receivedAt: Date | null;
};

export async function mailtrapInboundConfig() {
  const s = await getSettings();
  return {
    token: s.mailtrap_token || process.env.MAILTRAP_TOKEN || "",
    signingSecret: s.mailtrap_signing_secret || process.env.MAILTRAP_SIGNING_SECRET || "",
    inboxId: s.mailtrap_inbound_inbox_id || process.env.MAILTRAP_INBOUND_INBOX_ID || "",
    apiBase: s.mailtrap_api_base || process.env.MAILTRAP_API_BASE || "https://mailtrap.io",
  };
}

/**
 * Verify the `Mailtrap-Signature` header: HMAC-SHA256 of the RAW request body,
 * hex encoded.
 *
 * The raw body matters. Re-serialising parsed JSON changes key order and
 * whitespace, so the digest no longer matches and every event is rejected —
 * or worse, someone "fixes" it by skipping verification.
 */
export function verifyMailtrapSignature(
  rawBody: string,
  headerSignature: string | null,
  signingSecret: string,
): boolean {
  if (!signingSecret || !headerSignature) return false;
  const digest = createHmac("sha256", signingSecret).update(rawBody, "utf8").digest();
  const received = headerSignature.trim();
  // Hex is what Mailtrap documents. Base64 is accepted too because providers
  // change encoding between products and a rejected-but-genuine webhook is
  // indistinguishable from an attack in the logs. Both are full HMAC
  // comparisons, so accepting either encoding weakens nothing.
  return (
    constantTimeEquals(digest.toString("hex"), received.toLowerCase()) ||
    constantTimeEquals(digest.toString("base64"), received)
  );
}

function constantTimeEquals(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length — compare lengths first and only then in constant time.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Header names Mailtrap has used for the signature across its products. The
 * documented one is `Mailtrap-Signature`; the Symfony bridge advisory names
 * `X-Mt-Signature`, so a deployment can plausibly meet either.
 */
export const SIGNATURE_HEADERS = [
  "mailtrap-signature",
  "x-mailtrap-signature",
  "x-mt-signature",
  "mt-signature",
];

/** The signature header, whichever alias it arrived under. */
export function readSignatureHeader(headers: Headers): { name: string; value: string } | null {
  for (const name of SIGNATURE_HEADERS) {
    const value = headers.get(name);
    if (value) return { name, value };
  }
  return null;
}

/**
 * Pull the inbound events out of a webhook payload. Mailtrap batches them under
 * `events`, and sends JSON Lines for large batches, so both are accepted.
 */
export function parseInboundEvents(rawBody: string): MailtrapInboundEvent[] {
  const objects: unknown[] = [];
  const trimmed = rawBody.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const events = (parsed as { events?: unknown[] })?.events;
    if (Array.isArray(events)) objects.push(...events);
    else objects.push(parsed);
  } catch {
    // JSON Lines: one event per line.
    for (const line of trimmed.split("\n")) {
      if (!line.trim()) continue;
      try {
        objects.push(JSON.parse(line));
      } catch {
        // A malformed line is not worth failing the whole batch over.
      }
    }
  }

  const out: MailtrapInboundEvent[] = [];
  for (const obj of objects) {
    const e = obj as Record<string, unknown>;
    const event = String(e.event ?? "");
    // Mailtrap has used both "inbound.message_received" and the bare
    // "inbound_message_received" in its docs; accept either, ignore the rest.
    if (!/inbound[._]message_received/.test(event)) continue;
    const messageId = e.message_id ?? e.id ?? e.inbound_message_id;
    if (messageId === undefined || messageId === null || messageId === "") continue;
    const inbox = Number(e.inbox_id ?? e.inboxId);
    // Mailtrap sends epoch milliseconds.
    const ts = Number(e.timestamp);
    out.push({
      event,
      messageId: String(messageId),
      inboxId: Number.isFinite(inbox) ? inbox : null,
      eventId: e.event_id ? String(e.event_id) : null,
      from: typeof e.from === "string" ? e.from : null,
      receivedAt: Number.isFinite(ts) && ts > 0 ? new Date(ts) : null,
    });
  }
  return out;
}

export type MailtrapMessage = {
  id: string;
  from: string | null;
  to: string[] | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  received_at: string | null;
  rfc_message_id: string | null;
};

/** Fetch one inbound message. Returns null rather than throwing. */
export async function fetchInboundMessage(
  inboxId: string | number,
  messageId: string,
): Promise<MailtrapMessage | null> {
  const cfg = await mailtrapInboundConfig();
  if (!cfg.token) return null;
  try {
    const res = await fetch(
      `${cfg.apiBase.replace(/\/$/, "")}/api/inbound/inboxes/${inboxId}/messages/${encodeURIComponent(messageId)}`,
      {
        headers: { "Api-Token": cfg.token, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as MailtrapMessage;
  } catch {
    return null;
  }
}

/**
 * Shape a fetched Mailtrap message like the generic webhook payload the
 * existing normaliser already understands, so there is one ingestion path.
 */
export function messageToWebhookPayload(msg: MailtrapMessage): Record<string, unknown> {
  return {
    From: msg.from ?? "",
    To: (msg.to ?? []).join(", "),
    Subject: msg.subject ?? "",
    TextBody: msg.text_body ?? "",
    HtmlBody: msg.html_body ?? "",
    MessageID: msg.rfc_message_id || msg.id,
    Date: msg.received_at ?? new Date().toISOString(),
  };
}
