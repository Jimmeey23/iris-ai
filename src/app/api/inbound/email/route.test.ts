import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import { ingestEmail } from "@/lib/inbound-email";
import { fetchInboundMessage, mailtrapInboundConfig } from "@/lib/mailtrap-inbound";

// Mocked without loading the real module: it opens a DB connection at import
// time, which a route test has no business needing. The normalisers are pure
// and come from their own module, so they are re-exported for real.
vi.mock("@/lib/inbound-email", async () => {
  const normalize = await import("@/lib/inbound-email-normalize");
  return {
    normalizeWebhookEmail: normalize.normalizeWebhookEmail,
    normalizeFormEmail: normalize.normalizeFormEmail,
    ingestEmail: vi.fn(async () => ({ status: "created", ticketId: 7 })),
  };
});
vi.mock("@/lib/mailtrap-inbound", async (original) => ({
  ...(await original<typeof import("@/lib/mailtrap-inbound")>()),
  mailtrapInboundConfig: vi.fn(),
  fetchInboundMessage: vi.fn(),
}));

const SECRET = "whsec_test_secret";

const EVENT = JSON.stringify({
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

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://iris.test/api/inbound/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    }),
  );
}

beforeEach(() => {
  vi.mocked(mailtrapInboundConfig).mockResolvedValue({
    token: "tok",
    signingSecret: SECRET,
    inboxId: "1",
    apiBase: "https://mailtrap.io",
  });
  vi.mocked(fetchInboundMessage).mockResolvedValue({
    id: "1875440790670688064",
    from: "John Doe <sender@example.com>",
    to: ["inbound@physique57india.com"],
    subject: "AC not working",
    text_body: "The AC was off for the 7am class.",
    html_body: null,
    received_at: "2026-09-11T04:30:00Z",
    rfc_message_id: "<abc@mail.example.com>",
  });
  vi.mocked(ingestEmail).mockClear();
});

it("accepts a properly signed Mailtrap event and ingests the fetched message", async () => {
  const res = await post(EVENT, { "Mailtrap-Signature": sign(EVENT) });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({ ok: true });
  expect(fetchInboundMessage).toHaveBeenCalledWith(1, "1875440790670688064");
  expect(ingestEmail).toHaveBeenCalledOnce();
});

it("rejects a signature made with the wrong secret, and says which failure it was", async () => {
  const res = await post(EVENT, { "Mailtrap-Signature": sign(EVENT, "other-secret") });
  expect(res.status).toBe(401);
  await expect(res.json()).resolves.toMatchObject({ code: "bad_signature" });
  expect(ingestEmail).not.toHaveBeenCalled();
});

it("names the problem when a Mailtrap event arrives with no signature header", async () => {
  // This is the 401 people actually hit: the payload is genuine, but nothing
  // signed it, so the generic path rejects it as merely "Unauthorized".
  const res = await post(EVENT);
  expect(res.status).toBe(401);
  const body = (await res.json()) as { code: string; headersSeen: string[] };
  expect(body.code).toBe("missing_signature");
  // The header list is what identifies a renamed or stripped signature header.
  expect(body.headersSeen).toContain("content-type");
});

it("refuses rather than trusts when no signing secret is configured", async () => {
  vi.mocked(mailtrapInboundConfig).mockResolvedValue({
    token: "tok",
    signingSecret: "",
    inboxId: "1",
    apiBase: "https://mailtrap.io",
  });
  const res = await post(EVENT, { "Mailtrap-Signature": sign(EVENT) });
  expect(res.status).toBe(503);
  expect(ingestEmail).not.toHaveBeenCalled();
});

it("reads the signature under an alternative header name", async () => {
  const res = await post(EVENT, { "X-Mt-Signature": sign(EVENT) });
  expect(res.status).toBe(200);
  expect(ingestEmail).toHaveBeenCalledOnce();
});

it("asks Mailtrap to retry when the message cannot be fetched", async () => {
  vi.mocked(fetchInboundMessage).mockResolvedValue(null);
  const res = await post(EVENT, { "Mailtrap-Signature": sign(EVENT) });
  expect(res.status).toBe(500);
  await expect(res.json()).resolves.toMatchObject({
    results: [{ status: "fetch-failed" }],
  });
});

it("acknowledges a signed event it does not act on, so it is not retried forever", async () => {
  const other = JSON.stringify({ events: [{ event: "delivery", message_id: "1" }] });
  const res = await post(other, { "Mailtrap-Signature": sign(other) });
  expect(res.status).toBe(200);
  expect(ingestEmail).not.toHaveBeenCalled();
});
