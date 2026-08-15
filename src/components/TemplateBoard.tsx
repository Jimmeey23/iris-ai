"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Studio } from "@/db/schema";
import { TEMPLATES, TEMPLATE_GROUPS, RATING_OPTIONS, type Template, type TemplateField } from "@/lib/templates";
import { useUser } from "./Providers";
import MomencePicker, { type PickResult } from "./MomencePicker";
import TemplateBuilder from "./TemplateBuilder";
import FilloutEmbed from "./FilloutEmbed";
import { EmptyState, PriorityPill } from "./ui";
import type { CustomTemplate } from "@/db/schema";
import { useEscape, useScrollLock } from "@/lib/use-escape";
import { apiFetch, apiPost, ApiError } from "@/lib/api-client";

type Created = { id: number; ticketNumber: string; assigneeName: string | null; assigneeTeam: string | null; severity: string; slaHours: number };
type Attendee = {
  memberId: number;
  name: string;
  email: string | null;
  checkedIn: boolean;
  status: string;
  intent: string;
  comment: string;
};

const ATTENDEE_STATUS = ["Attended", "No show", "Late arrival", "Left early", "Walk-in"];
const ATTENDEE_INTENT = ["Hot — ready to buy", "Warm — follow up", "Cold — curiosity only", "Existing member", "Not assessed"];

export default function TemplateBoard({
  studios,
  custom = [],
}: {
  studios: Studio[];
  custom?: CustomTemplate[];
}) {
  const { user } = useUser();
  const [group, setGroup] = useState<string>("all");
  const [q, setQ] = useState("");
  const [active, setActive] = useState<Template | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null);

  useEscape(!!active, () => setActive(null));
  useEscape(!!picker && !active, () => setPicker(null));
  useScrollLock(!!active);

  const [embedOpen, setEmbedOpen] = useState<CustomTemplate | null>(null);
  useEscape(!!embedOpen, () => setEmbedOpen(null));

  const customAsTemplates = useMemo<Template[]>(
    () =>
      custom
        .filter((c) => c.kind === "form")
        .map((c) => ({
          id: `custom-${c.id}`,
          name: c.name,
          blurb: c.blurb || "Custom template",
          icon: c.icon,
          category: c.category,
          subcategory: c.subcategory,
          priority: c.priority as Template["priority"],
          raisedFor: c.raisedFor,
          group: c.group as Template["group"],
          fields: (c.fields as unknown as Template["fields"]) ?? [],
          compose: (v: Record<string, string>) =>
            [
              c.name,
              ...Object.entries(v)
                .filter(([k, val]) => val && !k.endsWith("Name") && !k.endsWith("Id"))
                .map(([k, val]) => `${k}: ${val}`),
            ].join(" — "),
        })),
    [custom],
  );

  const embedTemplates = useMemo(() => custom.filter((c) => c.kind === "embed"), [custom]);

  const allTemplates = useMemo(() => [...customAsTemplates, ...TEMPLATES], [customAsTemplates]);

  const list = useMemo(() => {
    let rows = group === "all" ? allTemplates : allTemplates.filter((t) => t.group === group);
    if (q.trim()) {
      const term = q.toLowerCase();
      rows = rows.filter((t) => `${t.name} ${t.blurb} ${t.category} ${t.subcategory}`.toLowerCase().includes(term));
    }
    return rows;
  }, [group, q, allTemplates]);

  const visibleEmbeds = useMemo(() => {
    let rows = group === "all" ? embedTemplates : embedTemplates.filter((c) => c.group === group);
    if (q.trim()) {
      const term = q.toLowerCase();
      rows = rows.filter((c) => `${c.name} ${c.blurb}`.toLowerCase().includes(term));
    }
    return rows;
  }, [embedTemplates, group, q]);

  const open = (t: Template) => {
    setActive(t);
    setV({});
    setAttendees([]);
    setCreated(null);
    setError(null);
    setPicker(null);
  };

  const set = (patch: Record<string, string>) => setV((prev) => ({ ...prev, ...patch }));

  const loadRoster = useCallback(async (sessionId: number) => {
    setLoadingRoster(true);
    try {
      const d = await apiFetch<{ attendees?: { memberId: number; name: string; email: string | null; checkedIn: boolean }[] }>(
        `/api/momence?resource=attendees&sessionId=${sessionId}`,
      );
      setAttendees(
        (d.attendees ?? []).map((a) => ({
          memberId: a.memberId,
          name: a.name,
          email: a.email,
          checkedIn: a.checkedIn,
          status: a.checkedIn ? "Attended" : "No show",
          intent: "Not assessed",
          comment: "",
        })),
      );
    } catch {
      setAttendees([]);
    } finally {
      setLoadingRoster(false);
    }
  }, []);

  const onPick = (field: TemplateField, r: PickResult) => {
    const meta = r.meta ?? {};
    if (field.kind === "member") {
      set({ [field.name]: r.value, memberName: r.label, memberId: String(meta.memberId ?? ""), memberContact: String(meta.email ?? meta.phone ?? "") });
    } else if (field.kind === "trainer") {
      set({ [field.name]: r.value, [`${field.name}Name`]: r.label, trainerName: r.label });
    } else if (field.kind === "studio") {
      set({ [field.name]: r.value, studioName: r.label, studioId: r.value.split(":")[1] ?? "" });
    } else if (field.kind === "membership") {
      set({ [field.name]: r.label, membershipName: r.label });
    } else {
      const sessionId = Number(meta.sessionId ?? 0);
      set({
        [field.name]: r.value,
        sessionName: String(meta.sessionName ?? r.label),
        sessionId: String(sessionId),
        sessionStart: String(meta.startsAt ?? ""),
        classAt: r.label.split(" · ").slice(1).join(" · "),
        trainerName: v.trainerName || String(meta.teacher ?? ""),
        studioName: v.studioName || String(meta.location ?? ""),
        scheduledStart: v.scheduledStart || new Date(String(meta.startsAt ?? Date.now())).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }),
      });
      if (active?.special === "hosted-class" && sessionId) void loadRoster(sessionId);
    }
    setPicker(null);
  };

  const visibleFields = useMemo(
    () => (active ? active.fields.filter((f) => !f.when || f.when(v)) : []),
    [active, v],
  );

  const progress = useMemo(() => {
    const req = visibleFields.filter((f) => f.required);
    if (req.length === 0) return 100;
    const done = req.filter((f) => {
      if (f.kind === "member") return !!v.memberName;
      if (f.kind === "trainer") return !!v.trainerName;
      if (f.kind === "session" || f.kind === "private-session") return !!v.sessionName;
      if (f.kind === "studio") return !!v.studioName;
      if (f.kind === "membership") return !!v.membershipName;
      return !!v[f.name]?.trim();
    }).length;
    return Math.round((done / req.length) * 100);
  }, [visibleFields, v]);

  const submit = async () => {
    if (!active) return;
    if (progress < 100) {
      setError("Please complete the required fields.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await apiPost<{ ticket?: Created; error?: string }>("/api/tickets", {
          category: active.category,
          subcategory: active.subcategory,
          description: active.compose(v),
          priority: active.priority,
          raisedFor: active.raisedFor,
          studioId: v.studioId ? Number(v.studioId) : null,
          studioName: v.studioName || "Not studio specific",
          memberName: v.memberName,
          memberContact: v.memberContact,
          momenceMemberId: v.memberId ? Number(v.memberId) : undefined,
          momenceSessionId: v.sessionId ? Number(v.sessionId) : undefined,
          membershipRef: v.membershipName,
          trainerName: v.trainerName,
          classInfo: v.sessionName,
          classAt: v.classAt,
          location: v.area,
          systemAffected: v.system ?? v.device,
          occurredAt: v.when,
          reportedBy: user.name,
          reportedByRole: `${user.role}, ${user.studio}`,
          source: `Template · ${active.name}`,
          details: Object.fromEntries(
            visibleFields
              .filter((f) => v[f.name] && !["member", "session", "private-session", "trainer", "studio", "membership", "attendees"].includes(f.kind))
              .map((f) => [f.label, v[f.name]]),
          ),
        });
      if (!data.ticket) {
        setError(data.error ?? "Could not raise the ticket.");
        return;
      }
      setCreated(data.ticket);

      if (active.special === "hosted-class") {
        await apiPost("/api/class-feedback", {
          ticketId: data.ticket.id,
          momenceSessionId: v.sessionId ? Number(v.sessionId) : undefined,
          sessionName: v.sessionName,
          sessionStart: v.sessionStart,
          hostName: v.hostName,
          trainerName: v.trainerName,
          studioName: v.studioName,
          attendeeCount: attendees.length,
          hostScore: Number((v.hostScore ?? "0").charAt(0)) || 0,
          classScore: Number((v.classScore ?? "0").charAt(0)) || 0,
          audienceRelevance: v.audienceRelevance,
          purchaseIntent: v.purchaseIntent,
          conversionCount: Number(v.conversionCount ?? 0) || attendees.filter((a) => a.intent.startsWith("Hot")).length,
          notes: v.notes,
          attendees,
          recordedBy: user.name,
        });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error — please retry.");
    } finally {
      setBusy(false);
    }
  };

  const renderField = (f: TemplateField) => {
    const isPicker = ["member", "session", "private-session", "trainer", "studio", "membership"].includes(f.kind);
    const shown =
      f.kind === "member" ? v.memberName
      : f.kind === "trainer" ? v[`${f.name}Name`] ?? v.trainerName
      : f.kind === "studio" ? v.studioName
      : f.kind === "membership" ? v.membershipName
      : v.sessionName;

    if (f.kind === "attendees") {
      return (
        <div key={f.name} className="rounded-xl border p-3 hairline" style={{ background: "var(--surface-2)" }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold txt">{f.label}</span>
            <span className="chip accent-soft">{attendees.length} from Momence</span>
            {loadingRoster && <span className="text-[10.5px] txt-3">loading roster…</span>}
          </div>
          {f.helper && <p className="mt-0.5 text-[10.5px] txt-3">{f.helper}</p>}
          {attendees.length === 0 ? (
            <p className="mt-2 text-[11.5px] txt-3">Select a hosted session above to pull the attendee list.</p>
          ) : (
            <div className="hide-scrollbar mt-2 max-h-[260px] space-y-2 overflow-y-auto">
              {attendees.map((a, i) => (
                <div key={a.memberId} className="rounded-lg border p-2 hairline" style={{ background: "var(--surface)" }}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium txt">{a.name}</span>
                    <span className={`chip !text-[9px] ${a.checkedIn ? "mint-soft" : ""}`} style={a.checkedIn ? undefined : { background: "var(--surface-3)", color: "var(--text-3)" }}>
                      {a.checkedIn ? "checked in" : "not checked in"}
                    </span>
                  </div>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    <select
                      className="field !py-1 !text-[11px]"
                      value={a.status}
                      onChange={(e) => setAttendees((prev) => prev.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)))}
                    >
                      {ATTENDEE_STATUS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <select
                      className="field !py-1 !text-[11px]"
                      value={a.intent}
                      onChange={(e) => setAttendees((prev) => prev.map((x, j) => (j === i ? { ...x, intent: e.target.value } : x)))}
                    >
                      {ATTENDEE_INTENT.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <input
                    className="field mt-1.5 !py-1 !text-[11px]"
                    placeholder="Comment about this guest…"
                    value={a.comment}
                    onChange={(e) => setAttendees((prev) => prev.map((x, j) => (j === i ? { ...x, comment: e.target.value } : x)))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div key={f.name} className="animate-rise">
        <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium txt-2">
          {f.label}
          {f.required && <span style={{ color: "var(--danger)" }}>*</span>}
          {isPicker && <span className="chip accent-soft !px-1.5 !py-0 !text-[8.5px]">Momence</span>}
        </label>

        {isPicker ? (
          <>
            <button
              onClick={() => setPicker(picker === f.name ? null : f.name)}
              className="flex w-full items-center gap-2 rounded-[10px] border px-3 py-2 text-left text-[12.5px] transition hairline"
              style={{ background: shown ? "var(--accent-soft)" : "var(--surface-2)", color: shown ? "var(--accent)" : "var(--text-3)" }}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{shown ?? `Search ${f.label.toLowerCase()}…`}</span>
              <span className="text-[10px]">{picker === f.name ? "▲" : "▼"}</span>
            </button>
            {picker === f.name && (
              <div className="mt-1.5">
                <MomencePicker
                  kind={f.kind as "member" | "session" | "private-session" | "trainer" | "studio" | "membership"}
                  studios={studios}
                  onPick={(r) => onPick(f, r)}
                />
              </div>
            )}
          </>
        ) : f.kind === "select" ? (
          <select className="field" value={v[f.name] ?? ""} onChange={(e) => set({ [f.name]: e.target.value })}>
            <option value="">Select…</option>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : f.kind === "rating" ? (
          <div className="flex flex-wrap gap-1.5">
            {RATING_OPTIONS.map((o) => (
              <button
                key={o}
                onClick={() => set({ [f.name]: o })}
                className="btn !px-2.5 !py-1.5 !text-[11.5px]"
                style={
                  v[f.name] === o
                    ? { background: "var(--accent)", color: "#fff" }
                    : { background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--line)" }
                }
              >
                {o}
              </button>
            ))}
          </div>
        ) : f.kind === "multiselect" ? (
          <div className="flex flex-wrap gap-1.5">
            {(f.options ?? []).map((o) => {
              const sel = (v[f.name] ?? "").split(" | ").filter(Boolean);
              const on = sel.includes(o);
              return (
                <button
                  key={o}
                  onClick={() =>
                    set({ [f.name]: (on ? sel.filter((x) => x !== o) : [...sel, o]).join(" | ") })
                  }
                  className="btn !px-2.5 !py-1.5 !text-[11.5px]"
                  style={
                    on
                      ? { background: "var(--accent)", color: "#fff" }
                      : { background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--line)" }
                  }
                >
                  {on ? "✓ " : ""}{o}
                </button>
              );
            })}
          </div>
        ) : f.kind === "textarea" ? (
          <textarea rows={3} className="field resize-none" placeholder={f.placeholder} value={v[f.name] ?? ""} onChange={(e) => set({ [f.name]: e.target.value })} />
        ) : f.kind === "boolean" ? (
          <div className="flex gap-1.5">
            {["Yes", "No"].map((o) => (
              <button
                key={o}
                onClick={() => set({ [f.name]: o })}
                className="btn !px-3 !py-1.5 !text-[11.5px]"
                style={
                  v[f.name] === o
                    ? { background: "var(--accent)", color: "#fff" }
                    : { background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--line)" }
                }
              >
                {o}
              </button>
            ))}
          </div>
        ) : (
          <input
            className="field"
            type={f.kind === "number" ? "number" : f.kind === "time" ? "time" : f.kind === "date" ? "date" : "text"}
            placeholder={f.placeholder}
            value={v[f.name] ?? ""}
            onChange={(e) => set({ [f.name]: e.target.value })}
          />
        )}
        {f.helper && <p className="mt-1 text-[10.5px] txt-3">{f.helper}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          <button className="pill-tab" data-active={group === "all"} onClick={() => setGroup("all")}>All</button>
          {TEMPLATE_GROUPS.map((g) => (
            <button key={g} className="pill-tab" data-active={group === g} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" className="field !w-[190px]" />
          <TemplateBuilder />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleEmbeds.map((c) => (
          <button key={`embed-${c.id}`} onClick={() => setEmbedOpen(c)} className="panel card-hover rounded-2xl p-4 text-left">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[15px] accent-soft">{c.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold txt">{c.name}</span>
                  <PriorityPill priority={c.priority} />
                </div>
                <p className="mt-1 text-[11px] leading-relaxed txt-3">{c.blurb || "Embedded Fillout form"}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="chip accent-soft !text-[9px]">Fillout embed</span>
                  <span className="chip chip-line !text-[9px]">{c.embedKind === "zite-v2" ? "Zite v2" : "Fillout v1"}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
        {list.map((t) => (
          <button key={t.id} onClick={() => open(t)} className="panel card-hover rounded-2xl p-4 text-left">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[15px] accent-soft">{t.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-semibold txt">{t.name}</span>
                  <PriorityPill priority={t.priority} />
                </div>
                <p className="mt-1 text-[11px] leading-relaxed txt-3">{t.blurb}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="chip !text-[9px]" style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                    {t.fields.length} fields
                  </span>
                  {t.special && <span className="chip accent-soft !text-[9px]">Momence roster</span>}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {list.length === 0 && visibleEmbeds.length === 0 && (
        <EmptyState title="No templates match" body="Try a different group, or create one with + New template." />
      )}

      {embedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button className="absolute inset-0 backdrop-blur-sm"
            style={{ background: "color-mix(in srgb, var(--page) 68%, transparent)" }}
            onClick={() => setEmbedOpen(null)} aria-label="Close" />
          <div className="panel animate-slide-up relative z-10 flex max-h-[94vh] w-full max-w-[840px] flex-col overflow-hidden rounded-3xl">
            <div className="flex items-center gap-2.5 border-b px-5 py-3.5 hairline" style={{ background: "var(--surface-2)" }}>
              <span className="flex h-8 w-8 items-center justify-center rounded-xl text-[14px] accent-soft">{embedOpen.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="serif truncate text-[20px] leading-none txt">{embedOpen.name}</div>
                <div className="mt-1 truncate text-[9px] uppercase tracking-[0.18em] txt-3">
                  {embedOpen.category} · {embedOpen.subcategory}
                </div>
              </div>
              <button onClick={() => setEmbedOpen(null)} className="btn btn-ghost !px-2 !py-1">×</button>
            </div>
            <div className="hide-scrollbar flex-1 overflow-y-auto">
              <FilloutEmbed
                embedId={embedOpen.embedId ?? ""}
                kind={(embedOpen.embedKind as "fillout-v1" | "zite-v2") ?? "fillout-v1"}
                height={embedOpen.embedHeight}
              />
            </div>
            <div className="border-t px-5 py-2.5 text-[10px] uppercase tracking-[0.16em] txt-3 hairline">
              Submissions post to /api/fillout · Esc to close
            </div>
          </div>
        </div>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <button
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: "color-mix(in srgb, var(--page) 68%, transparent)" }}
            onClick={() => setActive(null)}
            aria-label="Close"
          />
          <div
            className="animate-pop relative z-10 flex max-h-[94vh] w-full max-w-[680px] flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl hairline"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}
          >
            <div className="border-b hairline" style={{ background: "var(--surface-2)" }}>
              <div className="flex items-center gap-2.5 px-5 py-3.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[14px] accent-soft">{active.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold txt">{active.name}</div>
                  <div className="truncate text-[10.5px] txt-3">{active.category} · {active.subcategory}</div>
                </div>
                <PriorityPill priority={active.priority} />
                <button onClick={() => setActive(null)} className="btn btn-ghost !px-2 !py-1 !text-[13px]">×</button>
              </div>
              <div className="h-[3px] w-full" style={{ background: "var(--surface-3)" }}>
                <div className="h-full transition-all duration-500" style={{ width: `${progress}%`, background: "var(--accent)" }} />
              </div>
            </div>

            <div className="hide-scrollbar flex-1 overflow-y-auto px-5 py-4">
              {created ? (
                <div className="py-8 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-[20px]" style={{ background: "var(--mint-soft)", color: "var(--mint)" }}>✓</div>
                  <p className="mt-3 text-[17px] font-semibold txt">{created.ticketNumber} raised</p>
                  <p className="mt-1 text-[12.5px] txt-3">
                    {created.severity} severity · {created.slaHours}h SLA · assigned to {created.assigneeName ?? "triage"} ({created.assigneeTeam})
                  </p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Link href={`/tickets/${created.id}`} className="btn btn-primary">Open ticket</Link>
                    <button className="btn btn-ghost" onClick={() => open(active)}>Raise another</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3.5">
                  {visibleFields.map(renderField)}
                  {error && (
                    <p className="rounded-lg px-3 py-2 text-[11.5px] danger-soft">{error}</p>
                  )}
                </div>
              )}
            </div>

            {!created && (
              <div className="flex items-center gap-2 border-t px-5 py-3 hairline" style={{ background: "var(--surface-2)" }}>
                <span className="text-[10.5px] txt-3">
                  {visibleFields.length} fields shown · AI sets severity &amp; SLA on submit
                </span>
                <button onClick={() => setActive(null)} className="btn btn-ghost ml-auto">Cancel</button>
                <button onClick={submit} disabled={busy} className="btn btn-primary disabled:opacity-50">
                  {busy ? "Raising…" : "Raise ticket"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
