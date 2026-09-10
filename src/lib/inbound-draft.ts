import type { AiInsight } from "./enrich";
import { CATEGORY_DEPARTMENT } from "./org";
import type { TicketDraft } from "./types";
import type { NormalizedEmail } from "./inbound-email-normalize";

/* ------------------------------------------------------------------ */
/* Draft construction — email + insight → TicketDraft                   */
/* ------------------------------------------------------------------ */

const IMPACT_LABEL: Record<string, string> = {
  safety: "Safety risk",
  many: "Several members affected",
  single: "One member / minor disruption",
  suggestion: "Suggestion or idea",
};

export function buildDraftTicket(input: {
  email: NormalizedEmail;
  insight: AiInsight;
  category: string;
  subcategory: string;
  studio?: { id: number; name: string } | null;
  impact: string;
  atRisk: boolean;
  ownerHint?: string;
  missing: string[];
  source: string;
  replyDraft: { text: string; engine: string };
}): TicketDraft {
  const { email, insight, studio } = input;
  const from = email.fromName?.trim() || email.fromEmail;

  const description = [
    email.bodyText.trim(),
    "",
    `— Received by email from ${from} <${email.fromEmail}> on ${email.receivedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST, subject: "${email.subject}".`,
  ].join("\n");

  const details: Record<string, string> = {
    "From": from.includes("@") ? from : `${from} <${email.fromEmail}>`,
    "Email subject": email.subject,
  };
  if (input.missing.length) details["Iris could not find"] = input.missing.join(" · ");
  details["Draft reply"] = input.replyDraft.text;
  details["Reply engine"] = input.replyDraft.engine;
  details["Reply status"] = "awaiting approval";

  return {
    category: insight.category ?? input.category,
    subcategory: insight.subcategory ?? input.subcategory,
    ownerHint: input.ownerHint,
    title: insight.title.slice(0, 140),
    summary: insight.summary,
    description,
    priority: insight.priority,
    studioId: studio?.id ?? null,
    studioName: studio?.name ?? "Not studio specific",
    reportedBy: from,
    reportedByRole: "Email",
    raisedFor: /(member|client|guest)/i.test(`${email.subject} ${email.bodyText}`)
      ? "On behalf of a member"
      : "Noticed by staff",
    impact: IMPACT_LABEL[input.impact] ?? input.impact,
    sentiment: insight.sentiment,
    emotion: insight.emotion,
    urgencyScore: insight.urgencyScore,
    churnRisk: insight.churnRisk,
    effort: insight.effort,
    rootCause: insight.rootCause,
    suggestedAction: insight.suggestedAction,
    aiConfidence: Math.round(insight.confidence * 100),
    aiEngine: insight.engine,
    severity: insight.severity,
    slaRespondHours: insight.slaRespondHours,
    slaResolveHours: insight.slaResolveHours,
    slaPolicy: insight.slaPolicy,
    slaReason: insight.slaReason,
    department: CATEGORY_DEPARTMENT[insight.category ?? input.category] ?? "Operations",
    tags: [...new Set([...insight.tags, "email"])].slice(0, 6),
    details,
    source: input.source,
    priorityReason: insight.priorityReason,
  };
}

/* ------------------------------------------------------------------ */
/* Draft reply — held for staff approval, never auto-sent               */
/* ------------------------------------------------------------------ */

/**
 * Deterministic starting point for the member/staff reply. The LLM upgrade
 * (draftEmailReply) rewrites this with the specifics when a key is configured;
 * without one this honest template is what staff see and edit.
 */
export function localReplyTemplate(email: NormalizedEmail, insight: AiInsight): string {
  const first = (email.fromName ?? email.fromEmail.split("@")[0] ?? "there").split(" ")[0];
  const owner = insight.suggestedAction ? insight.suggestedAction.replace(/\.$/, "") : "the team is on it";
  return [
    `Hi ${first},`,
    "",
    `Thanks for writing in — I've logged this as "${insight.title}" and routed it to the right owner.`,
    `Where it stands: ${owner}.`,
    insight.slaRespondHours <= 24
      ? "We'll come back to you within 24 hours."
      : "We'll keep you posted as it moves.",
    "",
    "— Iris, on behalf of the Physique 57 team",
  ].join("\n");
}

/**
 * LLM rewrite of the template — specific to what the sender actually wrote.
 * Falls back to the deterministic template when no key is configured or the
 * call fails; the reply is ALWAYS held for staff approval either way.
 */
export async function draftEmailReply(
  email: NormalizedEmail,
  insight: AiInsight,
): Promise<{ text: string; engine: string }> {
  const fallback = { text: localReplyTemplate(email, insight), engine: "template" };
  try {
    const { chatJson } = await import("./llm");
    const res = await chatJson<{ reply?: string }>({
      system:
        "You draft one short email reply on behalf of a boutique fitness studio's team. Warm, human, specific to what the sender wrote — acknowledge their exact issue, say what happens next and roughly when. 90-140 words. No invented promises (no refunds/compensation offers), no tracking numbers, no sign-off name other than 'Iris, on behalf of the Physique 57 team'. Return JSON {\"reply\": string}.",
      user: `EMAIL FROM: ${email.fromName ?? ""} <${email.fromEmail}>\nSUBJECT: ${email.subject}\n\nBODY:\n${email.bodyText.slice(0, 3500)}\n\nINTERNAL TRIAGE (ground truth — never contradict): title: ${insight.title}; what we told the owner to do: ${insight.suggestedAction}; response SLA: ${insight.slaRespondHours}h.`,
      tier: "fast",
      temperature: 0.4,
      maxTokens: 350,
      timeoutMs: 20000,
      retries: 0,
      feature: "inbound-reply",
    });
    const reply = res.data?.reply?.trim();
    return res.ok && reply ? { text: reply, engine: res.model ?? "llm" } : fallback;
  } catch {
    return fallback;
  }
}
