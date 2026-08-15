"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Staff, Ticket, TicketEvent } from "@/db/schema";
import { PRIORITIES, STATUSES } from "@/lib/taxonomy";
import { useUser } from "./Providers";
import { ticketPermissions } from "@/lib/permissions";
import { Avatar, CategoryChip, PriorityPill, StatusPill, slaLabel, timeAgo } from "./ui";
import { apiFetch, ApiError } from "@/lib/api-client";
import MessageTemplatePanel from "./MessageTemplatePanel";

function riskTone(v: string) {
  return v === "High" ? "var(--signal)" : v === "Medium" ? "var(--accent)" : "var(--mint)";
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "var(--surface-3)" }}>
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

export default function TicketWorkspace({
  ticket,
  events,
  staff,
}: {
  ticket: Ticket;
  events: TicketEvent[];
  staff: Staff[];
}) {
  const router = useRouter();
  const { user } = useUser();
  const [comment, setComment] = useState("");
  const [resolution, setResolution] = useState(ticket.resolutionNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const sla = slaLabel(ticket.slaDueAt, ticket.status);
  const perms = ticketPermissions(ticket, { name: user.name, role: user.role });
  const locked = !perms.canEdit;

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setDenied(null);
    try {
      await apiFetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, actor: user.name, actorRole: user.role }),
      });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setDenied(err.message);
      } else {
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const facts = [
    { label: "Studio", value: ticket.studioName },
    { label: "Raised for", value: ticket.raisedFor },
    { label: "Member", value: ticket.memberName },
    { label: "Member contact", value: ticket.memberContact },
    { label: "Trainer", value: ticket.trainerName },
    { label: "Class", value: ticket.classInfo },
    { label: "Class time", value: ticket.classAt },
    { label: "Membership", value: ticket.membershipRef },
    { label: "Area", value: ticket.location },
    { label: "System", value: ticket.systemAffected },
    { label: "When", value: ticket.occurredAt },
    { label: "Impact", value: ticket.impact },
    { label: "Reported by", value: `${ticket.reportedBy}${ticket.reportedByRole ? ` · ${ticket.reportedByRole}` : ""}` },
    { label: "Source", value: ticket.source },
    ...Object.entries(ticket.details ?? {}).map(([label, value]) => ({ label, value })),
  ].filter((f): f is { label: string; value: string } => !!f.value && f.value !== "Not identified");

  const seen = new Set<string>();
  const rows = facts.filter((f) => {
    const key = `${f.label}:${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const mc = ticket.momenceContext as Record<string, unknown> | null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="panel overflow-hidden rounded-2xl">
          <div className="space-y-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold tabular txt-3">{ticket.ticketNumber}</span>
              <StatusPill status={ticket.status} />
              <PriorityPill priority={ticket.priority} />
              <span className="chip surface-3 txt-3">{ticket.department}</span>
              <span className={`text-[11px] font-medium ${sla.tone}`} suppressHydrationWarning>
                {sla.text}
              </span>
              <span className="text-[11px] txt-3" suppressHydrationWarning>
                · opened {timeAgo(ticket.createdAt)} ago
              </span>
            </div>
            <h1 className="serif text-[24px] leading-tight txt">{ticket.title}</h1>
            <CategoryChip category={ticket.category} subcategory={ticket.subcategory} />
            {ticket.summary && <p className="text-[13px] leading-relaxed txt-2">{ticket.summary}</p>}
            {ticket.description && (
              <div className="rounded-xl px-4 py-3" style={{ background: "var(--surface-3)" }}>
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Reported</div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed txt-2">{ticket.description}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {(ticket.tags ?? []).map((tag) => (
                <span key={tag} className="chip surface-3 txt-3 !text-[9.5px]">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* AI intelligence */}
        <div className="panel rounded-2xl">
          <header className="flex items-center gap-2 border-b px-5 py-3.5 hairline">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            <h2 className="serif text-[17px] leading-none txt">AI intelligence</h2>
            <span className="ml-auto text-[10.5px] txt-3">{ticket.aiEngine}</span>
          </header>
          <div className="space-y-3.5 p-5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <Metric label="Sentiment" value={ticket.sentiment} />
              <Metric label="Emotion" value={ticket.emotion} />
              <Metric label="Urgency" value={`${ticket.urgencyScore}/100`} tone="var(--signal)" />
              <Metric label="Churn risk" value={ticket.churnRisk} tone={riskTone(ticket.churnRisk)} />
              <Metric label="Effort" value={ticket.effort} />
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Metric label="Severity" value={ticket.severity} />
              <Metric label="SLA target" value={`${ticket.slaHours}h`} tone="var(--accent)" />
              <Metric label="First response" value={ticket.firstResponseAt ? "Logged" : "Pending"} tone={ticket.firstResponseAt ? "var(--mint)" : "var(--danger)"} />
              <Metric label="Department" value={ticket.department} />
            </div>
            {ticket.slaReason && (
              <p className="rounded-lg px-3 py-2 text-[11px] leading-relaxed accent-soft">{ticket.slaReason}</p>
            )}
            {ticket.rootCause && (
              <div>
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Probable root cause</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed txt-2">{ticket.rootCause}</p>
              </div>
            )}
            {ticket.suggestedAction && (
              <div>
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Recommended action</div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed txt-2">{ticket.suggestedAction}</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] txt-3">AI confidence</span>
              <div className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
                <div className="h-full rounded-full" style={{ width: `${ticket.aiConfidence}%`, background: "var(--accent)" }} />
              </div>
              <span className="text-[11px] font-semibold tabular txt-2">{ticket.aiConfidence}%</span>
            </div>
          </div>
        </div>

        {mc && Object.keys(mc).length > 0 && (
          <div className="panel rounded-2xl">
            <header className="flex items-center gap-2 border-b px-5 py-3.5 hairline">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--mint)" }} />
              <h2 className="serif text-[17px] leading-none txt">Momence record</h2>
            </header>
            <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-3">
              {Object.entries(mc)
                .filter(([, v]) => v !== null && v !== undefined && v !== "")
                .map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">
                      {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                    </dt>
                    <dd className="truncate text-[12.5px] font-medium txt-2">
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        )}

        <div className="panel rounded-2xl">
          <header className="border-b px-5 py-3.5 hairline">
            <h2 className="serif text-[17px] leading-none txt">Captured details</h2>
          </header>
          <dl className="grid gap-x-6 gap-y-3 p-5 sm:grid-cols-3">
            {rows.map((row) => (
              <div key={`${row.label}-${row.value}`} className="min-w-0">
                <dt className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">{row.label}</dt>
                <dd className="text-[12.5px] font-medium txt-2">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="panel rounded-2xl">
          <header className="border-b px-5 py-3.5 hairline">
            <h2 className="serif text-[17px] leading-none txt">Activity</h2>
            <p className="mt-0.5 text-[11.5px] txt-3">{events.length} entries</p>
          </header>
          <div className="space-y-4 p-5">
            <ol className="relative space-y-4 pl-5" style={{ borderLeft: "1px solid var(--line)" }}>
              {events.map((event) => (
                <li key={event.id} className="relative">
                  <span
                    className="absolute -left-[26px] top-1 h-2 w-2 rounded-full"
                    style={{
                      background: event.type === "ai" ? "var(--accent)" : event.type === "status" ? "var(--mint)" : "var(--text-3)",
                      boxShadow: "0 0 0 3px var(--surface)",
                    }}
                  />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[12px] font-semibold txt">{event.actor}</span>
                    <span className="text-[10.5px] txt-3" suppressHydrationWarning>
                      {timeAgo(event.createdAt)} ago
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed txt-2">{event.message}</p>
                </li>
              ))}
            </ol>

            <div className="rounded-xl border p-3 hairline" style={{ background: "var(--surface-2)" }}>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                disabled={!perms.canComment}
                placeholder={perms.canComment ? `Add an update as ${user.name}…` : "Only the assigned owner can comment"}
                className="w-full resize-none bg-transparent text-[12.5px] outline-none txt placeholder:text-[var(--text-3)]"
              />
              <div className="flex justify-end">
                <button
                  disabled={busy || !comment.trim() || !perms.canComment}
                  onClick={async () => {
                    await patch({ comment });
                    setComment("");
                  }}
                  className="btn btn-primary !py-1.5 !text-[12px] disabled:opacity-40"
                >
                  Post update
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="panel rounded-2xl p-5 space-y-4">
          <div
            className="flex items-start gap-2 rounded-xl px-3 py-2 text-[11px] leading-relaxed"
            style={{
              background: locked ? "var(--danger-soft)" : "var(--mint-soft)",
              color: locked ? "var(--danger)" : "var(--mint)",
            }}
          >
            <span className="mt-px">{locked ? "⚿" : "✓"}</span>
            <span>{perms.reason}</span>
          </div>
          {denied && (
            <p className="rounded-lg px-3 py-2 text-[11px] danger-soft">{denied}</p>
          )}

          <div>
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Status</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  disabled={busy || (s === "Resolved" || s === "Closed" ? !perms.canResolve : !perms.canEdit)}
                  onClick={() => void patch({ status: s })}
                  className={`btn !px-2.5 !py-1.5 !text-[11.5px] ${ticket.status === s ? "btn-primary" : "btn-ghost"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Priority</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRIORITIES.slice().reverse().map((p) => (
                <button
                  key={p}
                  disabled={busy || !perms.canEdit}
                  onClick={() => void patch({ priority: p })}
                  className={`btn !px-2.5 !py-1.5 !text-[11.5px] ${ticket.priority === p ? "btn-primary" : "btn-ghost"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Owner</span>
            <div className="mt-2 flex items-center gap-2.5 rounded-xl border p-2.5 hairline" style={{ background: "var(--surface-2)" }}>
              <Avatar name={ticket.assigneeName} size={32} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[12.5px] font-semibold txt">{ticket.assigneeName ?? "Unassigned"}</div>
                <div className="truncate text-[10.5px] txt-3">
                  {ticket.assigneeTeam}
                  {ticket.assigneeEmail ? ` · ${ticket.assigneeEmail}` : ""}
                </div>
              </div>
            </div>
            <select
              disabled={busy || !perms.canReassign}
              value={ticket.assigneeId ?? ""}
              onChange={(e) => void patch({ assigneeId: e.target.value ? Number(e.target.value) : null })}
              className="field mt-2"
            >
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.role}, {s.department}
                </option>
              ))}
            </select>
            {ticket.assignmentReason && (
              <p className="mt-2 rounded-lg px-3 py-2 text-[11px] leading-relaxed accent-soft">
                {ticket.assignmentReason}
              </p>
            )}
          </div>

          <div>
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Resolution notes</span>
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
              placeholder="What was done to close this out?"
              className="field mt-2 resize-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                disabled={busy || !perms.canEdit}
                onClick={() => void patch({ resolutionNotes: resolution })}
                className="btn btn-ghost flex-1"
              >
                Save notes
              </button>
              <button
                disabled={busy || !perms.canResolve}
                onClick={() =>
                  void patch({
                    resolutionNotes: resolution,
                    status: "Resolved",
                    comment: resolution ? `Resolved: ${resolution}` : undefined,
                  })
                }
                className="btn flex-1 disabled:opacity-50"
                style={{ background: "var(--mint)", color: "#fff" }}
              >
                Mark resolved
              </button>
            </div>
          </div>
        </div>

        {ticket.memberContact && ticket.memberContact.startsWith("+") && (
          <MessageTemplatePanel to={ticket.memberContact} />
        )}

        <div className="panel rounded-2xl p-5 space-y-2 text-[12px] txt-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Timeline</div>
          {[
            ["Created", new Date(ticket.createdAt)],
            ["SLA target", ticket.slaDueAt ? new Date(ticket.slaDueAt) : null],
            ["Last update", new Date(ticket.updatedAt)],
            ["Resolved", ticket.resolvedAt ? new Date(ticket.resolvedAt) : null],
          ].map(([label, date]) => (
            <div key={label as string} className="flex justify-between">
              <span className="txt-3">{label as string}</span>
              <span className="font-medium tabular" suppressHydrationWarning>
                {date
                  ? (date as Date).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
