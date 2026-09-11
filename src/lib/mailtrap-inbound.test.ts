import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import {
  messageToWebhookPayload,
  parseInboundEvents,
  verifyMailtrapSignature,
  type MailtrapMessage,
} from "./mailtrap-inbound";

const SECRET = "whsec_test_5f4dcc3b5aa765d61d8327deb882cf99";

// The exact payload Mailtrap documents for an inbound delivery.
const PAYLOAD = JSON.stringify({
  events: [
    {
      event: "inbound.message_received",
      event_id: "2ba5edd1-a8ad-11f1-b81f-0a58a9feac02",
      timestamp: 1733497282000,
      inbox_id: 1,
      message_id: "1875440790670688064",
      from: "John Doe <sender@example.com>",
    },
  ],
});

const sign = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");

/* ------------------------------------------------------------------ */
/* Signature                                                           */
/* ------------------------------------------------------------------ */

it("accepts a correctly signed body", () => {
  expect(verifyMailtrapSignature(PAYLOAD, sign(PAYLOAD), SECRET)).toBe(true);
});

it("accepts the signature whatever case it arrives in", () => {
  expect(verifyMailtrapSignature(PAYLOAD, sign(PAYLOAD).toUpperCase(), SECRET)).toBe(true);
  expect(verifyMailtrapSignature(PAYLOAD, ` ${sign(PAYLOAD)} `, SECRET)).toBe(true);
});

it("rejects a body that was altered after signing", () => {
  const tampered = PAYLOAD.replace("sender@example.com", "attacker@evil.com");
  expect(verifyMailtrapSignature(tampered, sign(PAYLOAD), SECRET)).toBe(false);
});

it("rejects a signature made with a different secret", () => {
  expect(verifyMailtrapSignature(PAYLOAD, sign(PAYLOAD, "wrong-secret"), SECRET)).toBe(false);
});

it("rejects a missing signature or a missing secret", () => {
  expect(verifyMailtrapSignature(PAYLOAD, null, SECRET)).toBe(false);
  expect(verifyMailtrapSignature(PAYLOAD, "", SECRET)).toBe(false);
  // An unconfigured secret must never mean "allow everything".
  expect(verifyMailtrapSignature(PAYLOAD, sign(PAYLOAD), "")).toBe(false);
});

it("rejects a signature of the wrong length without throwing", () => {
  // timingSafeEqual throws on mismatched lengths — that must not surface.
  expect(() => verifyMailtrapSignature(PAYLOAD, "abc123", SECRET)).not.toThrow();
  expect(verifyMailtrapSignature(PAYLOAD, "abc123", SECRET)).toBe(false);
});

it("is sensitive to re-serialisation, which is why the raw body is signed", () => {
  // Key order and spacing change the bytes; the digest of a re-stringified
  // payload will not match. This is the trap the route has to avoid.
  const reserialised = JSON.stringify(JSON.parse(PAYLOAD), ["events"], 2);
  expect(verifyMailtrapSignature(reserialised, sign(PAYLOAD), SECRET)).toBe(false);
});

/* ------------------------------------------------------------------ */
/* Event parsing                                                       */
/* ------------------------------------------------------------------ */

it("pulls the message id, inbox and timestamp out of the documented payload", () => {
  const events = parseInboundEvents(PAYLOAD);
  expect(events).toHaveLength(1);
  expect(events[0].messageId).toBe("1875440790670688064");
  expect(events[0].inboxId).toBe(1);
  expect(events[0].eventId).toBe("2ba5edd1-a8ad-11f1-b81f-0a58a9feac02");
  expect(events[0].from).toBe("John Doe <sender@example.com>");
  expect(events[0].receivedAt?.toISOString()).toBe("2024-12-06T15:01:22.000Z");
});

it("keeps the message id as a string so a 19-digit id is not mangled", () => {
  // 1875440790670688064 exceeds Number.MAX_SAFE_INTEGER — parsing it as a
  // number would silently change the last digits and fetch the wrong message.
  const id = parseInboundEvents(PAYLOAD)[0].messageId;
  expect(id).toBe("1875440790670688064");
  expect(String(Number(id))).not.toBe(id);
});

it("reads a batch of events", () => {
  const body = JSON.stringify({
    events: [
      { event: "inbound.message_received", message_id: "1", inbox_id: 2 },
      { event: "inbound.message_received", message_id: "2", inbox_id: 2 },
    ],
  });
  expect(parseInboundEvents(body).map((e) => e.messageId)).toEqual(["1", "2"]);
});

it("reads JSON Lines as well as a wrapped array", () => {
  const body = [
    JSON.stringify({ event: "inbound.message_received", message_id: "1", inbox_id: 2 }),
    JSON.stringify({ event: "inbound.message_received", message_id: "2", inbox_id: 2 }),
  ].join("\n");
  expect(parseInboundEvents(body).map((e) => e.messageId)).toEqual(["1", "2"]);
});

it("ignores events that are not an inbound delivery", () => {
  const body = JSON.stringify({
    events: [
      { event: "delivery", message_id: "1" },
      { event: "open", message_id: "2" },
      { event: "inbound.message_received", message_id: "3", inbox_id: 1 },
    ],
  });
  expect(parseInboundEvents(body).map((e) => e.messageId)).toEqual(["3"]);
});

it("survives an empty or malformed body", () => {
  expect(parseInboundEvents("")).toEqual([]);
  expect(parseInboundEvents("not json at all")).toEqual([]);
  expect(parseInboundEvents('{"events":[{"event":"inbound.message_received"}]}')).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Fetched message → the shape the normaliser understands              */
/* ------------------------------------------------------------------ */

it("maps a fetched message onto the existing webhook shape", () => {
  const msg: MailtrapMessage = {
    id: "1875440790670688064",
    from: "Anita Rao <anita@example.com>",
    to: ["studio@physique57india.com", "ops@physique57india.com"],
    subject: "AC not working in Studio 2",
    text_body: "The AC was off for the whole 7am class.",
    html_body: "<p>The AC was off for the whole 7am class.</p>",
    received_at: "2026-09-11T04:30:00Z",
    rfc_message_id: "<abc@mail.example.com>",
  };
  const payload = messageToWebhookPayload(msg);
  expect(payload.From).toBe("Anita Rao <anita@example.com>");
  expect(payload.To).toBe("studio@physique57india.com, ops@physique57india.com");
  expect(payload.Subject).toBe("AC not working in Studio 2");
  expect(payload.TextBody).toContain("7am class");
  // The RFC id is the stable one across retries and threading.
  expect(payload.MessageID).toBe("<abc@mail.example.com>");
});

it("falls back to Mailtrap's own id when the message has no RFC id", () => {
  const payload = messageToWebhookPayload({
    id: "999",
    from: "a@b.com",
    to: null,
    subject: null,
    text_body: null,
    html_body: null,
    received_at: null,
    rfc_message_id: null,
  });
  expect(payload.MessageID).toBe("999");
  expect(payload.To).toBe("");
});
