import { describe, expect, it } from "vitest";
import {
  missingForTicket,
  normalizeFormEmail,
  normalizeWebhookEmail,
  stripQuotedReplies,
  threadKeyOf,
  type NormalizedEmail,
} from "./inbound-email-normalize";
import { buildDraftTicket, localReplyTemplate } from "./inbound-draft";
import type { AiInsight } from "./enrich";

const insight: AiInsight = {
  title: "Air-conditioning not cooling Studio 1",
  summary: "The AC in Studio 1 has been ineffective through the morning classes.",
  sentiment: "Negative",
  emotion: "Frustrated",
  urgencyScore: 62,
  churnRisk: "Medium",
  effort: "Medium",
  rootCause: "Air-conditioning unit failure.",
  suggestedAction: "Have the AC unit inspected and serviced before evening classes.",
  priority: "High",
  priorityReason: "Facility fault affecting members.",
  tags: ["ac", "facility"],
  confidence: 0.82,
  engine: "Iris NLU",
  severity: "Major",
  slaRespondHours: 24,
  slaResolveHours: 72,
  slaPolicy: "High priority",
  slaReason: "facility fault",
};

describe("webhook normalisation", () => {
  it("parses a Postmark-shaped payload", () => {
    const email = normalizeWebhookEmail({
      FromName: "Meera Shah",
      From: "meera@example.com",
      To: "iris@physique57.in",
      Subject: "Re: AC in Studio 1",
      TextBody: "The studio is boiling again, members walked out of the 8am class.",
      MessageID: "pm-123",
      Date: "2026-09-10T09:30:00+05:30",
    });
    expect(email).not.toBeNull();
    expect(email!.fromEmail).toBe("meera@example.com");
    expect(email!.fromName).toBe("Meera Shah");
    expect(email!.messageId).toBe("pm-123");
    expect(email!.threadKey).toBe("meera@example.com|ac in studio 1");
    expect(email!.receivedAt.getUTCFullYear()).toBe(2026);
  });

  it("parses a generic JSON payload with a display-name sender", () => {
    const email = normalizeWebhookEmail({
      from: "Arjun Rao <arjun@gymcorp.in>",
      subject: "Invoice charged twice",
      text: "I was charged twice for the September pack.",
    });
    expect(email!.fromEmail).toBe("arjun@gymcorp.in");
    expect(email!.fromName).toBe("Arjun Rao");
    expect(email!.messageId).toMatch(/^h_/);
  });

  it("falls back to HTML when no text part exists", () => {
    const email = normalizeWebhookEmail({
      from: "a@b.in",
      subject: "Hi",
      html: "<p>Locker <b>broken</b> again</p>",
    });
    expect(email!.bodyText).toContain("Locker");
    expect(email!.bodyText).toContain("broken");
  });

  it("rejects payloads without an email-like sender", () => {
    expect(normalizeWebhookEmail({ subject: "hi", text: "body" })).toBeNull();
    expect(normalizeWebhookEmail("not an object")).toBeNull();
    expect(normalizeWebhookEmail(null)).toBeNull();
  });

  it("parses a SendGrid inbound-parse form payload", () => {
    const email = normalizeFormEmail({
      from: "Priya <priya@example.org>",
      subject: "Fwd: late trainer",
      text: "The 7pm trainer arrived 20 minutes late.",
      envelope: JSON.stringify({ to: ["iris@physique57.in"] }),
    });
    expect(email!.fromEmail).toBe("priya@example.org");
    expect(email!.subject).toBe("Fwd: late trainer");
    expect(email!.toEmail).toBe("iris@physique57.in");
  });
});

describe("thread + quoting", () => {
  it("collapses reply and forward prefixes into one thread key", () => {
    const a = threadKeyOf("x@y.in", "Re: Re: AC broken");
    const b = threadKeyOf("x@y.in", "AC broken");
    const c = threadKeyOf("x@y.in", "FWD: AC broken");
    expect(a).toBe(b);
    expect(c).toBe(b);
    expect(threadKeyOf("other@y.in", "AC broken")).not.toBe(b);
  });

  it("strips quoted reply history", () => {
    const stripped = stripQuotedReplies("Still no hot water today.\n\nOn 9 Sep 2026, Dev wrote:\n> earlier stuff");
    expect(stripped).toBe("Still no hot water today.");
    expect(stripQuotedReplies("body one\n--\nOriginal Message\nFrom: someone")).toContain("body one");
    expect(stripQuotedReplies("body one\nFrom: x@y.in\nSubject: fw")).toBe("body one");
  });
});

describe("triage gaps + draft", () => {
  const base: NormalizedEmail = {
    messageId: "m1",
    threadKey: "a@b.in|x",
    fromName: "Meera Shah",
    fromEmail: "meera@example.com",
    toEmail: "iris@physique57.in",
    subject: "AC in the Bandra studio",
    bodyText: "The AC isn't cooling and members walked out. We tried resetting the unit.",
    receivedAt: new Date(),
    raw: {},
  };

  it("names what the email did not say", () => {
    const missing = missingForTicket(base);
    expect(missing).toContain("When exactly");
    expect(missing).not.toContain("Which studio");
    expect(missing).not.toContain("What has been tried");
  });

  it("builds a routable draft with owner hint, email source and reply", () => {
    const draft = buildDraftTicket({
      email: base,
      insight,
      category: "Studio Amenities and Facilities",
      subcategory: "Studio Temperature / AC",
      studio: { id: 3, name: "Bandra / Juhu" },
      impact: "many",
      atRisk: false,
      ownerHint: "Studio Management",
      missing: ["When exactly"],
      source: "email",
      replyDraft: { text: "Hi Meera, we're on it.", engine: "template" },
    });
    expect(draft.source).toBe("email");
    expect(draft.ownerHint).toBe("Studio Management");
    expect(draft.studioId).toBe(3);
    expect(draft.reportedBy).toBe("Meera Shah");
    expect(draft.priority).toBe("High");
    expect(draft.department).toBeTruthy();
    expect(draft.details["Draft reply"]).toBe("Hi Meera, we're on it.");
    expect(draft.details["Reply status"]).toBe("awaiting approval");
    expect(draft.details["Iris could not find"]).toContain("When exactly");
    expect(draft.description).toContain("meera@example.com");
  });

  it("template reply is personal, specific and never promises refunds", () => {
    const reply = localReplyTemplate(base, insight);
    expect(reply).toContain("Meera");
    expect(reply).toContain(insight.title);
    expect(reply).not.toMatch(/refund|compensat|discount/i);
  });
});
