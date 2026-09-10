"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Studio } from "@/db/schema";
import { useUser } from "./Providers";
import ContextBar from "./ContextBar";
import IrisBot from "./IrisBot";
import MomencePicker from "./MomencePicker";
import { Avatar, CategoryChip, PriorityPill } from "./ui";
import { useEscape } from "@/lib/use-escape";
import { download, toHtml, toJson, toMarkdown, toPdf, toPlainText, toPng } from "@/lib/chat-export";
import type { ChatMessage, ChatOption, ComposerContext, TicketDraft } from "@/lib/types";
import { ApiError, apiPost, apiPostStream } from "@/lib/api-client";

function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold txt">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
          return (
            <span key={i} className="mt-1.5 block text-[11px] leading-relaxed txt-3">
              {part.slice(1, -1)}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function Meter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">{label}</span>
        <span className="text-[11px] font-semibold tabular txt">{value}</span>
      </div>
      <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: tone }} />
      </div>
    </div>
  );
}

function riskTone(v: string) {
  return v === "High" ? "var(--signal)" : v === "Medium" ? "var(--accent)" : "var(--mint)";
}

export function DraftCard({ draft }: { draft: TicketDraft }) {
  const facts: { label: string; value?: string }[] = [
    { label: "Studio", value: draft.studioName },
    { label: "Raised for", value: draft.raisedFor },
    { label: "Member", value: draft.memberName },
    { label: "Contact", value: draft.memberContact },
    { label: "Trainer", value: draft.trainerName },
    { label: "Class", value: draft.classInfo },
    { label: "Class time", value: draft.classAt },
    { label: "Package", value: draft.membershipRef },
    { label: "Area", value: draft.location },
    { label: "System", value: draft.systemAffected },
    { label: "When", value: draft.occurredAt },
    { label: "Impact", value: draft.impact },
  ].filter((f) => f.value && f.value !== "Not identified" && f.value !== "Not specified");

  const extra = Object.entries(draft.details ?? {}).filter(
    ([k]) => !facts.some((f) => f.label.toLowerCase() === k.toLowerCase()),
  );

  const sev = draft.severity;
  const sevColor =
    sev === "Severe" ? "var(--danger)" : sev === "Major" ? "var(--warn)" : sev === "Moderate" ? "var(--accent)" : "var(--mint)";

  return (
    <div className="panel animate-slide-up sheen mt-2.5 overflow-hidden rounded-3xl">
      {/* masthead */}
      <div className="relative px-5 pb-4 pt-4" style={{ background: "var(--surface-2)" }}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: sevColor }} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.24em] txt-3">Ticket draft</span>
          <span className="chip chip-line">{draft.department}</span>
          {draft.ownerHint && (
            <span className="chip chip-line !text-[9px]" title="Who usually owns these tickets, from the historic issue patterns">
              Suggested owner: {draft.ownerHint}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <span className="chip" style={{ background: "var(--surface-3)", color: sevColor }}>{sev}</span>
            <PriorityPill priority={draft.priority} />
          </span>
        </div>
        <h3 className="serif mt-2.5 text-[22px] leading-tight txt">{draft.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <CategoryChip category={draft.category} subcategory={draft.subcategory} />
          {draft.tags.slice(0, 4).map((t) => (
            <span key={t} className="chip chip-line !text-[9px]">{t}</span>
          ))}
        </div>
      </div>

      {/* SLA strip */}
      <div className="grid grid-cols-2 divide-x border-y sm:grid-cols-4 hairline" style={{ borderColor: "var(--line)" }}>
        {[
          { l: "Respond within", v: `${draft.slaRespondHours}h`, c: "var(--accent)" },
          { l: "Resolve within", v: `${draft.slaResolveHours}h`, c: sevColor },
          { l: "Urgency", v: `${draft.urgencyScore}`, c: "var(--text)" },
          { l: "Churn risk", v: draft.churnRisk, c: draft.churnRisk === "High" ? "var(--danger)" : draft.churnRisk === "Medium" ? "var(--warn)" : "var(--mint)" },
        ].map((m) => (
          <div key={m.l} className="px-3 py-2.5" style={{ borderColor: "var(--line)" }}>
            <div className="text-[8.5px] font-semibold uppercase tracking-[0.16em] txt-3">{m.l}</div>
            <div className="serif mt-0.5 text-[19px] leading-none tabular" style={{ color: m.c }}>{m.v}</div>
          </div>
        ))}
      </div>

      <div className="space-y-4 px-5 py-4">
        <p className="text-[12.5px] leading-relaxed txt-2">{draft.summary}</p>

        {draft.description && (
          <section>
            <div className="mb-1.5 text-[8.5px] font-semibold uppercase tracking-[0.2em] txt-3">Reported</div>
            <p className="whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed txt-2" style={{ background: "var(--surface-3)" }}>
              {draft.description}
            </p>
          </section>
        )}

        {(draft.secondaryIssues?.length ?? 0) > 0 && (
          <section>
            <div className="mb-1.5 text-[8.5px] font-semibold uppercase tracking-[0.2em] txt-3">
              Also raised as linked tickets
            </div>
            <ul className="space-y-1.5">
              {draft.secondaryIssues!.map((issue) => (
                <li
                  key={issue.title}
                  className="rounded-2xl px-3.5 py-2.5"
                  style={{ background: "var(--surface-3)" }}
                >
                  <div className="text-[12px] font-medium txt">{issue.title}</div>
                  <div className="mt-0.5 text-[11px] txt-3">
                    {issue.category} › {issue.subcategory}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(facts.length > 0 || extra.length > 0) && (
          <section>
            <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.2em] txt-3">Captured detail</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
              {[...facts, ...extra.map(([label, value]) => ({ label, value }))].map((f) => (
                <div key={f.label} className="min-w-0 border-l pl-2.5 hairline" style={{ borderColor: "var(--line)" }}>
                  <dt className="text-[8.5px] font-semibold uppercase tracking-[0.14em] txt-3">{f.label}</dt>
                  <dd className="truncate text-[12px] font-medium txt">{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* AI assessment */}
        <section className="rounded-2xl p-3.5" style={{ background: "var(--surface-3)" }}>
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full live-dot" style={{ background: "var(--accent)" }} />
            <span className="text-[8.5px] font-semibold uppercase tracking-[0.2em] accent-txt">AI assessment</span>
            <span className="ml-auto text-[9px] txt-3">{draft.aiEngine}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {[
              ["Sentiment", draft.sentiment],
              ["Emotion", draft.emotion],
              ["Effort", draft.effort],
              ["SLA policy", draft.slaPolicy],
            ].map(([l, v]) => (
              <div key={l}>
                <div className="text-[8.5px] font-semibold uppercase tracking-[0.14em] txt-3">{l}</div>
                <div className="mt-0.5 truncate text-[12px] font-medium txt">{v}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-2 border-t pt-3 hairline">
            <div>
              <div className="text-[8.5px] font-semibold uppercase tracking-[0.14em] txt-3">Probable root cause</div>
              <p className="mt-0.5 text-[12px] leading-relaxed txt-2">{draft.rootCause}</p>
            </div>
            <div>
              <div className="text-[8.5px] font-semibold uppercase tracking-[0.14em] txt-3">Recommended next step</div>
              <p className="mt-0.5 text-[12px] leading-relaxed txt-2">{draft.suggestedAction}</p>
            </div>
            {draft.priorityReason && (
              <div>
                <div className="text-[8.5px] font-semibold uppercase tracking-[0.14em] txt-3">Severity logic</div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed txt-3">{draft.priorityReason}</p>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t pt-2.5 hairline">
            <span className="text-[9px] uppercase tracking-[0.14em] txt-3">Confidence</span>
            <span className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface)" }}>
              <span className="grow-bar block h-full rounded-full" style={{ width: `${draft.aiConfidence}%`, background: "var(--accent)" }} />
            </span>
            <span className="text-[11px] font-semibold tabular txt">{draft.aiConfidence}%</span>
          </div>
        </section>

        {draft.momenceContext?.memberId && (
          <section className="rounded-2xl px-3.5 py-2.5" style={{ background: "var(--mint-soft)" }}>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--mint)" }} />
              <span className="text-[8.5px] font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--mint)" }}>
                Momence record attached
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] txt-2">
              <span>ID {draft.momenceContext.memberId}</span>
              {draft.momenceContext.memberVisits != null && <span>{draft.momenceContext.memberVisits} visits</span>}
              {draft.momenceContext.memberships?.[0] && <span>{draft.momenceContext.memberships[0]}</span>}
              {draft.momenceContext.creditsLeft != null && <span>{draft.momenceContext.creditsLeft} credits left</span>}
              {draft.momenceContext.sessionName && <span>{draft.momenceContext.sessionName}</span>}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-[10px] txt-3 hairline">
          <span className="uppercase tracking-[0.14em]">Filed by {draft.reportedBy}</span>
          <span className="opacity-40">·</span>
          <span>{draft.source}</span>
          <span className="ml-auto uppercase tracking-[0.14em]">Routes to {draft.department}</span>
        </div>
      </div>
    </div>
  );
}

function CreatedCard({ created }: { created: NonNullable<ChatMessage["created"]> }) {
  return (
    <div
      className="animate-pop mt-2.5 overflow-hidden rounded-3xl"
      style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--mint), var(--shadow-md)" }}
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5 hairline" style={{ background: "var(--mint-soft)" }}>
        <span className="text-[13px] font-semibold tabular" style={{ color: "var(--mint)" }}>
          {created.ticketNumber}
        </span>
        <span className="ml-auto">
          <PriorityPill priority={created.priority} />
        </span>
      </div>
      <div className="space-y-2.5 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={created.assigneeName} size={30} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[12.5px] font-semibold txt">
              {created.assigneeName ?? "Unassigned — pending triage"}
            </div>
            <div className="truncate text-[10.5px] txt-3">
              {created.assigneeTeam}
              {created.assigneeEmail ? ` · ${created.assigneeEmail}` : ""}
            </div>
          </div>
        </div>
        {created.assignmentReason && (
          <p className="rounded-lg px-3 py-2 text-[11px] leading-relaxed txt-2" style={{ background: "var(--surface-3)" }}>
            {created.assignmentReason}
          </p>
        )}
        {created.slaDueAt && (
          <p className="text-[11.5px] txt-2">
            SLA target{" "}
            <strong className="font-semibold txt" suppressHydrationWarning>
              {new Date(created.slaDueAt).toLocaleString("en-IN", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </strong>
          </p>
        )}
        <Link href={`/tickets/${created.id}`} className="btn btn-primary !py-1.5 !text-[12px]">
          Open ticket →
        </Link>
      </div>
    </div>
  );
}

function OptionButton({ option, disabled, onClick }: { option: ChatOption; disabled: boolean; onClick: () => void }) {
  const cls =
    option.tone === "primary"
      ? "btn btn-primary"
      : option.tone === "danger"
        ? "btn"
        : option.tone === "ghost"
          ? "btn btn-ghost"
          : "btn btn-solid";
  const style =
    option.tone === "danger"
      ? { background: "var(--signal-soft)", color: "var(--signal)", border: "1px solid var(--signal)" }
      : undefined;
  return (
    <button
      className={`${cls} !px-3 !py-1.5 !text-[12px] disabled:opacity-40`}
      disabled={disabled}
      onClick={onClick}
      title={option.hint}
      style={style}
    >
      <span className="max-w-[280px] truncate">{option.label}</span>
    </button>
  );
}

const CAPTURE_FIELDS: { key: string; label: string; format?: (v: unknown) => string }[] = [
  { key: "category", label: "Category" },
  { key: "subcategory", label: "Subcategory" },
  { key: "studioName", label: "Studio" },
  { key: "raisedFor", label: "Raised for" },
  { key: "memberName", label: "Member" },
  { key: "trainerName", label: "Trainer" },
  { key: "classInfo", label: "Class" },
  { key: "membershipRef", label: "Membership" },
  { key: "location", label: "Area" },
  { key: "systemAffected", label: "System" },
  { key: "occurredAt", label: "When" },
  { key: "impact", label: "Impact" },
  { key: "atRisk", label: "Risk", format: (v) => (v ? "Yes" : "No") },
];

// Some preview proxies mangle POST + Accept: text/event-stream requests (the
// browser sees an immediate 400 while the identical JSON POST succeeds). Once
// detected, stop paying the double round-trip on every send: remember it for
// this browser session and go straight to plain JSON.
let streamBlocked = false;
try {
  if (typeof sessionStorage !== "undefined") streamBlocked = sessionStorage.getItem("iris:streamBlocked") === "1";
} catch {}
function rememberStreamBlocked(): void {
  streamBlocked = true;
  try {
    sessionStorage.setItem("iris:streamBlocked", "1");
  } catch {}
}

export default function ChatAssistant({ studios }: { studios: Studio[] }) {
  const { user } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<"agent" | "deterministic" | "unavailable">("agent");
  const [capture, setCapture] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState("describe");
  const [context, setContext] = useState<ComposerContext>({});
  const [dense, setDense] = useState(false);
  const [botSays, setBotSays] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stickBottom, setStickBottom] = useState(true);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceInfo, setEnhanceInfo] = useState<{ engine: string; changes: string[] } | null>(null);
  const [preEnhance, setPreEnhance] = useState<string | null>(null);
  const [startedAt] = useState(() => new Date().toISOString());
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const send = useCallback(
    async (payload: { value?: string; text?: string; label?: string; reset?: boolean }) => {
      setBusy(true);
      setPartial("");
      setStatus(null);
      const echo = payload.text ?? (payload.label && payload.value !== "showall" ? payload.label : null);
      if (echo) {
        setMessages((prev) => [
          ...prev,
          { id: `l${Date.now()}`, role: "user", content: echo, createdAt: new Date().toISOString() },
        ]);
      }

      const request = {
        sessionId: payload.reset ? null : sessionId,
        input: { value: payload.value, text: payload.text, context },
        reporter: { name: user.name, role: `${user.role}, ${user.studio}` },
        reset: payload.reset,
      };

      type TurnResult = {
        sessionId: string;
        messages: ChatMessage[];
        step: string;
        capture: Record<string, unknown>;
        mode: "agent" | "deterministic" | "unavailable";
        model?: string;
      };

      const apply = (data: TurnResult) => {
        setSessionId(data.sessionId);
        setStep(data.step);
        setCapture(data.capture ?? {});
        setAgentMode(data.mode ?? "agent");
        if (payload.reset) {
          setMessages(data.messages);
          setContext({});
        } else setMessages((prev) => [...prev, ...data.messages]);
      };

      // Raising the ticket is not idempotent, so it never goes over the stream —
      // a dropped connection there could create the ticket twice.
      const streamable = payload.value !== "approve";

      try {
        let result: TurnResult | null = null;
        let sawServer = false;
        if (streamable && !streamBlocked) {
          try {
            await apiPostStream("/api/chat/stream", request, {
              status: (d) => {
                sawServer = true;
                setStatus((d as { status?: string }).status ?? null);
              },
              reply_reset: () => setPartial(""),
              reply: (d) => {
                sawServer = true;
                setPartial((prev) => prev + ((d as { text?: string }).text ?? ""));
              },
              done: (d) => {
                sawServer = true;
                result = d as TurnResult;
              },
              error: () => {
                sawServer = true;
              },
            });
          } catch (err) {
            if (
              !sawServer &&
              err instanceof ApiError &&
              [400, 403, 413, 415, 422].includes(err.status)
            ) {
              rememberStreamBlocked();
            }
            // Fall through to the decision below.
          }
        }

        // Retry over plain JSON only when the stream never reached the server.
        // A stream that started and then died may have already done the work.
        if (!result && (!sawServer || !streamable)) {
          result = await apiPost<TurnResult>("/api/chat", request);
        }
        if (!result) throw new Error("stream ended without a result");
        apply(result);
      } catch (err) {
        const reason = err instanceof Error && err.message ? ` (${err.message.slice(0, 200)})` : "";
        setMessages((prev) => [
          ...prev,
          {
            id: `e${Date.now()}`,
            role: "assistant",
            content: `Sorry — I couldn't reach the ticketing service. Please try again.${reason}`,
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setPartial("");
        setStatus(null);
        setBusy(false);
      }
    },
    [sessionId, user, context],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send({ reset: true });
  }, [send]);

  // Follow the conversation unless the user has scrolled up to read.
  useEffect(() => {
    if (!stickBottom) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, stickBottom]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickBottom(distance < 90);
  }, []);

  useEscape(exportOpen, () => setExportOpen(false));

  const exportMeta = useMemo(
    () => ({
      reporter: user.name,
      role: `${user.role}, ${user.studio}`,
      startedAt,
      ticketNumber: messages.find((m) => m.created)?.created?.ticketNumber,
    }),
    [user, startedAt, messages],
  );

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  const doExport = useCallback(
    async (kind: "json" | "html" | "text" | "markdown" | "pdf" | "png" | "copy") => {
      setExportOpen(false);
      if (kind === "copy") {
        await navigator.clipboard.writeText(toPlainText(messages, exportMeta));
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
        return;
      }
      if (kind === "json") return download(`iris-${stamp}.json`, toJson(messages, exportMeta), "application/json");
      if (kind === "html") return download(`iris-${stamp}.html`, toHtml(messages, exportMeta), "text/html");
      if (kind === "text") return download(`iris-${stamp}.txt`, toPlainText(messages, exportMeta), "text/plain");
      if (kind === "markdown") return download(`iris-${stamp}.md`, toMarkdown(messages, exportMeta), "text/markdown");
      if (kind === "pdf") return toPdf(messages, exportMeta);
      if (kind === "png" && transcriptRef.current) {
        try {
          await toPng(transcriptRef.current, `iris-${stamp}.png`);
        } catch {
          download(`iris-${stamp}.html`, toHtml(messages, exportMeta), "text/html");
        }
      }
    },
    [messages, exportMeta, stamp],
  );

  const enhance = useCallback(async () => {
    const text = input.trim();
    if (text.length < 3 || enhancing) return;
    setEnhancing(true);
    setEnhanceInfo(null);
    try {
      const d = await apiPost<{ ok?: boolean; enhanced?: string; engine?: string; changes?: string[] }>(
        "/api/ai/enhance",
        {
          text,
          context: {
            studioName: context.studioName,
            memberName: context.memberName,
            trainerName: context.trainerName,
            classInfo: context.classInfo,
            category: context.category,
          },
        },
      );
      if (d.ok && d.enhanced) {
        setPreEnhance(text);
        setInput(d.enhanced);
        setEnhanceInfo({ engine: d.engine ?? "Iris", changes: d.changes ?? [] });
      }
    } finally {
      setEnhancing(false);
    }
  }, [input, enhancing, context]);

  const lastAssistant = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant"), [messages]);
  const placeholder = lastAssistant?.placeholder ?? "Type your message…";
  const remaining = lastAssistant?.remaining ?? 0;
  const activePicker = step === "created" ? undefined : lastAssistant?.picker;
  const mood: "idle" | "thinking" | "happy" | "alert" | "listening" = busy
    ? "thinking"
    : step === "created"
      ? "happy"
      : step === "review"
        ? "happy"
        : String(capture.atRisk) === "true"
          ? "alert"
          : input.length > 0
            ? "listening"
            : "idle";

  const rows = CAPTURE_FIELDS.map((f) => ({
    label: f.label,
    value:
      capture[f.key] === undefined || capture[f.key] === "" || capture[f.key] === null
        ? null
        : f.format
          ? f.format(capture[f.key])
          : String(capture[f.key]),
  }));
  const filled = rows.filter((r) => r.value).length;
  const progress = step === "created" ? 100 : Math.min(96, Math.round((filled / 8) * 100));
  const showContextBar = step === "describe";

  return (
    <div className="grid w-full gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="panel relative flex h-[76vh] min-h-[540px] flex-col overflow-hidden rounded-3xl">
        {/* header */}
        <div className="flex items-center gap-2 border-b px-4 py-2.5 hairline" style={{ background: "var(--surface-2)" }}>
          <IrisBot mood={mood} size={44} onPoke={() => setBotSays("Ask me anything — I'll do the paperwork.")} />
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold txt">
              Iris
              <span title="The server reports how this turn was produced" className={`chip !px-1.5 !py-0 !text-[9px] ${agentMode === "unavailable" ? "amber-soft" : "mint-soft"}`}>
                {agentMode === "unavailable" ? "reasoning unavailable" : agentMode === "deterministic" ? "review mode" : "AI reasoning"}
              </span>
              {remaining > 0 && (
                <span className="chip accent-soft !px-1.5 !py-0 !text-[9px]">{remaining} left</span>
              )}
            </div>
            <div className="truncate text-[10.5px] txt-3">
              {botSays ?? "Dynamic AI intake · classifies, enriches, routes"}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setDense((d) => !d)}
              className="btn btn-ghost !px-2 !py-1.5 !text-[11px]"
              title="Toggle compact mode"
            >
              {dense ? "Comfort" : "Compact"}
            </button>
            <button
              onClick={() => void send({ value: "undo" })}
              disabled={busy || messages.length < 3}
              className="btn btn-ghost !px-2 !py-1.5 !text-[11px] disabled:opacity-40"
              title="Undo last answer"
            >
              Undo
            </button>
            <div className="relative">
              <button
                onClick={() => setExportOpen((o) => !o)}
                className="btn btn-ghost !px-2 !py-1.5 !text-[11px]"
                title="Export transcript"
              >
                {copied ? "Copied ✓" : "Export"}
              </button>
              {exportOpen && (
                <>
                  <button className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} aria-label="close" />
                  <div
                    className="animate-pop absolute right-0 top-full z-40 mt-2 w-[190px] rounded-2xl p-1.5"
                    style={{ background: "var(--surface)", border: "1px solid var(--line)", boxShadow: "var(--shadow-lg)" }}
                  >
                    <div className="px-2 pb-1 pt-0.5 text-[9px] uppercase tracking-[0.18em] txt-3">Transcript</div>
                    {([
                      ["copy", "Copy to clipboard"],
                      ["pdf", "PDF (print)"],
                      ["png", "PNG image"],
                      ["html", "HTML page"],
                      ["json", "JSON data"],
                      ["markdown", "Markdown"],
                      ["text", "Plain text"],
                    ] as const).map(([kind, label]) => (
                      <button
                        key={kind}
                        onClick={() => void doExport(kind)}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-[12px] txt-2 transition hover:bg-[var(--surface-3)] hover:txt"
                      >
                        {label}
                      </button>
                    ))}
                    <div className="mt-1 border-t px-2 pb-0.5 pt-1.5 text-[9px] uppercase tracking-[0.16em] txt-3 hairline">
                      Esc to close
                    </div>
                  </div>
                </>
              )}
            </div>
            <button onClick={() => void send({ reset: true })} className="btn btn-ghost !px-2.5 !py-1.5 !text-[11px]">
              Restart
            </button>
          </div>
        </div>

        {/* messages */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="hide-scrollbar relative flex-1 overflow-y-auto px-4 sm:px-5"
        >
          <div ref={transcriptRef} className={dense ? "space-y-2 py-3" : "space-y-3.5 py-4"}>
          {messages.map((message, idx) => {
            const isLast = idx === messages.length - 1;
            if (message.role === "user") {
              return (
                <div key={message.id} className="animate-slide-up flex justify-end gap-2">
                  <div
                    className="max-w-[72%] rounded-2xl rounded-br-md px-3.5 py-2 text-[12.5px] leading-relaxed text-white"
                    style={{ background: "var(--accent)", boxShadow: "var(--glow)" }}
                  >
                    {message.content}
                  </div>
                  <Avatar name={user.name} color={user.color} size={26} />
                </div>
              );
            }
            return (
              <div key={message.id} className="animate-type flex gap-2">
                <span
                  className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] text-white grad-accent"
                >
                  ✦
                </span>
                <div className="min-w-0 max-w-[92%] flex-1">
                  <div
                    className="rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[12.5px] leading-relaxed txt-2"
                    style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--line)" }}
                  >
                    <p className="whitespace-pre-wrap">
                      <Rich text={message.content} />
                    </p>

                    {message.inferred && message.inferred.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {message.inferred.map((chip) => (
                          <span key={chip} className="chip mint-soft !text-[9.5px]">
                            ✓ {chip}
                          </span>
                        ))}
                      </div>
                    )}

                    {message.analysis && (
                      <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {message.analysis.map((a) => (
                          <div
                            key={a.label}
                            className="rounded-xl px-2.5 py-1.5"
                            style={{ background: "var(--surface-3)" }}
                          >
                            <div className="text-[9px] font-semibold uppercase tracking-[0.1em] txt-3">{a.label}</div>
                            <div className="truncate text-[11.5px] font-medium txt">{a.value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {message.draft && <DraftCard draft={message.draft} />}
                  {message.created && <CreatedCard created={message.created} />}

                  {message.options && message.options.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.options.map((option) => (
                        <OptionButton
                          key={option.value}
                          option={option}
                          disabled={!isLast || busy}
                          onClick={() => void send({ value: option.value, label: option.label })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="flex gap-2">
              <span className="grad-accent mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] text-white">
                ✦
              </span>
              <div className="min-w-0 space-y-1.5">
                {partial ? (
                  /* Iris's reply as it is being written. */
                  <div
                    className="rounded-2xl rounded-tl-md px-3.5 py-2.5 text-[13px] leading-relaxed txt"
                    style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--line)" }}
                  >
                    {partial}
                    <span className="caret-blink ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] rounded-full" style={{ background: "var(--accent)" }} />
                  </div>
                ) : (
                  <div
                    className="flex w-fit items-center gap-1 rounded-2xl rounded-tl-md px-3.5 py-2.5"
                    style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--line)" }}
                  >
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="dot-blink h-1.5 w-1.5 rounded-full"
                        style={{ background: "var(--accent)", animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                )}
                {status && (
                  <div className="pl-1 text-[10.5px] txt-3">{status}…</div>
                )}
              </div>
            </div>
          )}
            <div ref={bottomRef} />
          </div>
        </div>

        {!stickBottom && (
          <button
            onClick={() => {
              setStickBottom(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            }}
            className="animate-pop absolute bottom-[104px] left-1/2 z-20 -translate-x-1/2 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white"
            style={{ background: "var(--accent)", boxShadow: "var(--glow)" }}
          >
            ↓ Jump to latest
          </button>
        )}

        {/* composer */}
        <div className="border-t px-4 py-3 hairline" style={{ background: "var(--surface-2)" }}>
          {activePicker && showPicker && (
            <div className="mb-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] accent-txt">
                  {activePicker === "membership" ? "Membership catalogue" : "Momence lookup"}
                </span>
                <button onClick={() => setShowPicker(false)} className="text-[10px] txt-3 hover:txt">
                  hide
                </button>
              </div>
              <MomencePicker
                kind={activePicker}
                studios={studios}
                autoFocus={false}
                onPick={(r) => {
                  setShowPicker(true);
                  void send({ value: r.value, label: r.label });
                }}
              />
            </div>
          )}
          {activePicker && !showPicker && (
            <button onClick={() => setShowPicker(true)} className="btn btn-ghost mb-2 !py-1 !text-[11px]">
              Show Momence lookup
            </button>
          )}
          {showContextBar && (
            <div className="mb-2.5">
              <ContextBar studios={studios} context={context} onChange={setContext} draftText={input} />
            </div>
          )}
          {enhanceInfo && (
            <div className="animate-pop mb-2 flex flex-wrap items-center gap-2 rounded-xl px-3 py-1.5 accent-soft">
              <span className="text-[10.5px] font-semibold">✦ Enhanced by {enhanceInfo.engine}</span>
              {enhanceInfo.changes.slice(0, 2).map((c) => (
                <span key={c} className="chip chip-line !text-[9px]">{c}</span>
              ))}
              {preEnhance && (
                <button
                  onClick={() => {
                    setInput(preEnhance);
                    setPreEnhance(null);
                    setEnhanceInfo(null);
                  }}
                  className="ml-auto text-[10.5px] underline opacity-75 hover:opacity-100"
                >
                  Revert
                </button>
              )}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = input.trim();
              if (!text || busy) return;
              setInput("");
              setEnhanceInfo(null);
              setPreEnhance(null);
              void send({ text });
            }}
            className="flex items-center gap-2"
          >
            <div className="relative flex-1">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={placeholder}
                disabled={busy}
                className="field !py-2.5 !pr-[38px]"
              />
              <button
                type="button"
                onClick={() => void enhance()}
                disabled={enhancing || busy || input.trim().length < 3}
                title="Enhance with AI — clearer, fuller, more professional"
                className="absolute right-1.5 top-1/2 flex h-[26px] w-[26px] -translate-y-1/2 items-center justify-center rounded-lg text-[12px] transition disabled:opacity-30"
                style={{
                  background: enhancing ? "var(--accent)" : "var(--surface-3)",
                  color: enhancing ? "#fff" : "var(--accent)",
                }}
              >
                <span className={enhancing ? "spin-slow inline-block" : undefined}>✦</span>
              </button>
            </div>
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="btn btn-primary !h-[38px] !w-[38px] !px-0 disabled:opacity-35"
              aria-label="Send"
            >
              ↑
            </button>
          </form>
        </div>
      </div>

      {/* side rail */}
      <aside className="hide-scrollbar sticky top-[86px] max-h-[76vh] space-y-3 overflow-y-auto">
        <div className="panel rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] txt-3">Captured</span>
            <span className="text-[11px] font-semibold accent-txt tabular">{progress}%</span>
          </div>
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${progress}%`, background: "var(--accent)" }} />
          </div>
          <dl className="mt-3 space-y-1.5">
            {rows.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-3">
                <dt className="text-[11px] txt-3">{row.label}</dt>
                <dd className={`max-w-[62%] truncate text-right text-[11.5px] font-medium ${row.value ? "txt" : "txt-3 opacity-40"}`}>
                  {row.value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="panel rounded-2xl p-4">
          <div className="text-[9px] font-semibold uppercase tracking-[0.2em] txt-3">How Iris works</div>
          <ol className="mt-2.5 space-y-2.5">
            {[
              ["Listens", "Reads your note for studio, member, trainer, class, timing and impact."],
              ["Skips ahead", "Never asks anything you've already said or attached."],
              ["Thinks", "Adds sentiment, urgency, churn risk, severity, SLA and next action."],
              ["Routes", "Assigns by department, seniority, studio and live workload."],
            ].map(([title, body], i) => (
              <li key={title} className="flex gap-2.5">
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold accent-soft">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-[11.5px] font-semibold txt">{title}</span>
                  <span className="block text-[11px] leading-relaxed txt-3">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
