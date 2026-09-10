/**
 * Pure email normalisation — no database, no IO. Shared by the webhook route,
 * the manual paste path and the tests. `ingestEmail` in inbound-email.ts does
 * the DB work around these.
 */
import { createHash } from "node:crypto";

export type NormalizedEmail = {
  messageId: string;
  threadKey: string;
  fromName: string | null;
  fromEmail: string;
  toEmail: string | null;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  raw: Record<string, unknown>;
};

const EMAIL_RE = /([^\s<>"',;]+@[^\s<>"',;]+\.[^\s<>"',;]+)/;

function firstEmail(value: unknown): { email: string; name: string | null } | null {
  const raw = typeof value === "string" ? value : "";
  if (!raw.trim()) return null;
  // "Full Name <addr@host>" → name + address; bare address → address only.
  const m = raw.match(EMAIL_RE);
  if (!m) return null;
  const name = raw.includes("<") ? raw.replace(/<[^>]*>/g, "").replace(/["']/g, "").trim() || null : null;
  return { email: m[1].toLowerCase(), name };
}

/** "Re: AC …", "Fwd: AC …" → "ac …" so a whole thread collapses to one key. */
export function threadKeyOf(fromEmail: string, subject: string): string {
  const cleaned = subject
    .replace(/^\s*((re|fwd?|aw|fw)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return `${fromEmail.toLowerCase()}|${cleaned}`;
}

function hashId(...parts: string[]): string {
  return `h_${createHash("sha256").update(parts.join("\u0001")).digest("hex").slice(0, 24)}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Strip quoted history ("On 10 Sep, X wrote:" and everything below). */
export function stripQuotedReplies(text: string): string {
  const markers = [/^On .+, .+ wrote:\s*$/m, /^-{2,}\s*Original Message\s*-{2,}\s*$/im, /^From:\s.*$/m, /^>\s/];
  let cut = text.length;
  for (const re of markers) {
    const m = text.match(re);
    if (m && m.index !== undefined && m.index < cut) {
      // "From:" mid-text is usually the forwarded block; at position 0 it is the header.
      if (re.source.startsWith("^From") && m.index === 0) continue;
      cut = m.index;
    }
  }
  return text.slice(0, cut).trim() || text.trim();
}

/**
 * Accept the payload shapes of the common inbound-mail providers (Postmark,
 * SendGrid inbound parse) plus a plain generic shape — and reduce them to one
 * NormalizedEmail. Returns null when nothing email-like is present.
 */
export function normalizeWebhookEmail(payload: unknown): NormalizedEmail | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  const from = firstEmail(str(p.From) || str(p.from) || str(p.sender));
  if (!from) return null;

  const to = firstEmail(str(p.To) || str(p.to)) ?? null;
  const subject = str(p.Subject) || str(p.subject) || "(no subject)";
  const text = str(p.TextBody) || str(p.text) || str(p.body) || str(p.TextPart) || str(p.Body);
  if (!text && !str(p.HtmlBody) && !str(p.html)) return null;
  const bodyText = stripQuotedReplies(text || htmlToText(str(p.HtmlBody) || str(p.html)));

  const messageId =
    str(p.MessageID) || str(p.messageId) || str(p["Message-Id"]) || str(p.messageID) || hashId(from.email, subject, bodyText.slice(0, 400));

  const dateRaw = str(p.Date) || str(p.date);
  const receivedAt = dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw) : new Date();

  return {
    messageId,
    threadKey: threadKeyOf(from.email, subject),
    fromName: str(p.FromName) || from.name,
    fromEmail: from.email,
    toEmail: to?.email ?? null,
    subject,
    bodyText,
    receivedAt,
    raw: p,
  };
}

/** Accept SendGrid inbound-parse style form-encoded bodies. */
export function normalizeFormEmail(form: Record<string, string>): NormalizedEmail | null {
  const from = firstEmail(str(form.from) || str(form.sender));
  if (!from) return null;
  const envelope = (() => {
    try {
      return JSON.parse(str(form.envelope) || "{}") as { from?: string; to?: string[] };
    } catch {
      return {} as { from?: string; to?: string[] };
    }
  })();
  const to = firstEmail(str(form.to)) ?? firstEmail(envelope.to?.[0]);
  const subject = str(form.subject) || "(no subject)";
  const bodyText = stripQuotedReplies(str(form.text) || htmlToText(str(form.html)));
  if (!bodyText) return null;
  const messageId = str(form["Message-Id"]) || str(form.messageId) || hashId(from.email, subject, bodyText.slice(0, 400));
  return {
    messageId,
    threadKey: threadKeyOf(from.email, subject),
    fromName: from.name,
    fromEmail: from.email,
    toEmail: to?.email ?? null,
    subject,
    bodyText,
    receivedAt: new Date(),
    raw: { ...form },
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Facts the email did not give us — shown on the ticket and the inbox. */
export function missingForTicket(email: NormalizedEmail): string[] {
  const missing: string[] = [];
  const text = `${email.subject} ${email.bodyText}`;
  if (!/(studio|kemps|kwality|bandra|juhu|colaba|indiranagar|kenkere|bengaluru|bangalore|mumbai)/i.test(text)) {
    missing.push("Which studio");
  }
  if (!/\b(class|session|slot|am|pm|morning|afternoon|evening|night)\b/i.test(text)) missing.push("When exactly");
  if (!/(tried|done|fixed|restart|reset|called|checked|told)/i.test(text)) missing.push("What has been tried");
  if (!/(member|client|guest|staff|trainer|team)/i.test(text)) missing.push("Who is affected");
  return missing;
}
