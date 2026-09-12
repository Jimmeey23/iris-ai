"use client";

import { useEffect, useMemo, useState } from "react";
import type { Studio } from "@/db/schema";
import { MEMBERSHIPS } from "@/lib/catalog";
import { apiFetch } from "@/lib/api-client";

export type PickerKind =
  | "member"
  | "session"
  /** Multi-select over the real timetable, for an incident spanning several classes. */
  | "sessions"
  /** Multi-select over the people actually booked into the chosen sessions. */
  | "attendees"
  | "private-session"
  | "trainer"
  | "studio"
  | "membership";

export type PickResult = {
  value: string;
  label: string;
  meta?: Record<string, string | number | null>;
};

type MemberRow = { id: number; name: string; email: string | null; phone: string | null; visits: number };
type AttendeeRow = {
  memberId: number;
  name: string;
  email: string | null;
  phone: string | null;
  checkedIn: boolean;
  cancelled: boolean;
  sessionId: number;
  sessionName: string;
};
type SessionRow = {
  id: number;
  name: string;
  startsAt: string;
  teacher: string | null;
  location: string | null;
  capacity?: number | null;
  booked?: number | null;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/** Module scope: a component defined during render remounts every keystroke. */
function Row({
  primary,
  secondary,
  right,
  checked,
  onClick,
}: {
  primary: string;
  secondary?: string;
  right?: string;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={checked}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--surface-3)]"
      style={checked ? { background: "var(--surface-3)" } : undefined}
    >
      {checked !== undefined && (
        <span
          aria-hidden
          className="grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold hairline"
          style={checked ? { background: "var(--accent)", color: "#fff", borderColor: "transparent" } : undefined}
        >
          {checked ? "✓" : ""}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium txt">{primary}</span>
        {secondary && <span className="block truncate text-[10.5px] txt-3">{secondary}</span>}
      </span>
      {right && <span className="shrink-0 text-[10px] tabular txt-3">{right}</span>}
    </button>
  );
}

export default function MomencePicker({
  kind,
  studios = [],
  onPick,
  onConfirm,
  sessionIds = [],
  compact = false,
  autoFocus = true,
}: {
  kind: PickerKind;
  studios?: Studio[];
  onPick: (r: PickResult) => void;
  /** Multi-select kinds report the whole selection at once. */
  onConfirm?: (rs: PickResult[]) => void;
  /** Sessions whose rosters the "attendees" kind should load. */
  sessionIds?: number[];
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<unknown[]>([]);
  // `loading` is derived from which request the rows belong to: keying it to the
  // query means no effect has to flip a flag synchronously, and a keystroke
  // shows the spinner from its first frame instead of a flash of stale rows.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, PickResult>>({});

  const multi = kind === "sessions" || kind === "attendees";
  const sessionKey = sessionIds.join(",");
  const noAttendeeSessions = kind === "attendees" && !sessionKey;

  useEffect(() => {
    if (kind === "studio" || kind === "membership") return;
    const resource =
      kind === "member"
        ? "members"
        : kind === "trainer"
          ? "directory"
          : kind === "private-session"
            ? "private-sessions"
            : kind === "attendees"
              ? "attendees"
              : "sessions";
    // Attendees are keyed by the sessions already on the ticket, not by a
    // search term — there is nothing to type until sessions are chosen.
    const url =
      resource === "attendees"
        ? `/api/momence?resource=attendees&sessionIds=${encodeURIComponent(sessionKey)}`
        : `/api/momence?resource=${resource}&q=${encodeURIComponent(q)}&days=${kind === "private-session" ? 150 : 14}`;
    const requestKey = `${kind}|${q}|${sessionKey}`;
    // Nothing to ask for until sessions are chosen; the render path treats that
    // as settled, so the effect writes no state of its own.
    if (noAttendeeSessions) return;
    const t = setTimeout(() => {
      apiFetch<Record<string, unknown[]>>(url)
        .then((d) => {
          setRows(d.members ?? d.sessions ?? d.trainers ?? d.attendees ?? []);
        })
        .catch(() => setRows([]))
        .finally(() => setSettledKey(requestKey));
    }, 240);
    return () => clearTimeout(t);
  }, [kind, q, sessionKey, noAttendeeSessions]);

  const toggle = (key: string, r: PickResult) =>
    setChosen((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = r;
      return next;
    });


  const loading = !noAttendeeSessions && settledKey !== `${kind}|${q}|${sessionKey}`;
  /** Rows only count for the request they came back for. */
  const visibleRows = noAttendeeSessions ? [] : rows;

  const staticRows = useMemo(() => {
    if (kind === "studio") {
      return studios
        .filter((s) => !q || `${s.name} ${s.city}`.toLowerCase().includes(q.toLowerCase()))
        .map((s) => ({ id: s.id, primary: s.name, secondary: s.city, value: `ans:studio|${s.name}, ${s.city}` }));
    }
    if (kind === "membership") {
      return MEMBERSHIPS.filter((m) => !q || m.toLowerCase().includes(q.toLowerCase())).map((m, i) => ({
        id: i,
        primary: m,
        secondary: m.split(" ")[0],
        value: `ans:membershipRef|${m}`,
      }));
    }
    return null;
  }, [kind, studios, q]);

  const placeholder =
    kind === "member"
      ? "Search Momence members…"
      : kind === "trainer"
        ? "Search trainers…"
        : kind === "studio"
          ? "Search studios…"
          : kind === "membership"
            ? "Search memberships & packages…"
            : kind === "private-session"
              ? "Search hosted / private sessions…"
              : kind === "attendees"
                ? "Filter the people booked in…"
                : "Search recent classes…";

  return (
    <div className={compact ? "" : "rounded-xl border p-2 hairline"} style={compact ? undefined : { background: "var(--surface)" }}>
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="field !py-1.5 !text-[12px]"
      />
      <div className="hide-scrollbar mt-1.5 max-h-[220px] space-y-0.5 overflow-y-auto">
        {loading && <div className="px-2 py-3 text-[11.5px] txt-3">Searching Momence…</div>}

        {staticRows?.map((r) => (
          <Row
            key={r.id}
            primary={r.primary}
            secondary={r.secondary}
            onClick={() => onPick({ value: r.value, label: r.primary })}
          />
        ))}

        {!staticRows && kind === "member" &&
          (visibleRows as MemberRow[]).map((m) => (
            <Row
              key={m.id}
              primary={m.name || m.email || `Member ${m.id}`}
              secondary={[m.email, m.phone].filter(Boolean).join(" · ")}
              right={`${m.visits} visits`}
              onClick={() =>
                onPick({
                  value: `ans:member|${m.name}`,
                  label: m.name,
                  meta: { memberId: m.id, email: m.email, phone: m.phone, visits: m.visits },
                })
              }
            />
          ))}

        {!staticRows && kind === "trainer" &&
          (visibleRows as { id: number; name: string }[])
            .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
            .slice(0, 40)
            .map((t) => (
              <Row key={t.id} primary={t.name} onClick={() => onPick({ value: `ans:trainer|${t.name}`, label: t.name, meta: { teacherId: t.id } })} />
            ))}

        {!staticRows && (kind === "session" || kind === "sessions" || kind === "private-session") &&
          (visibleRows as SessionRow[]).map((s) => (
            <Row
              key={`${s.id}-${s.startsAt}`}
              primary={s.name}
              secondary={`${fmt(s.startsAt)}${s.teacher ? ` · ${s.teacher}` : ""}${s.location ? ` · ${s.location}` : ""}`}
              right={s.capacity ? `${s.booked ?? 0}/${s.capacity}` : undefined}
              checked={multi ? Boolean(chosen[`s${s.id}`]) : undefined}
              onClick={() => {
                const r: PickResult = {
                  value: `ans:classInfo|${s.name}|${fmt(s.startsAt)}|${s.teacher ?? ""}`,
                  label: `${s.name} · ${fmt(s.startsAt)}`,
                  meta: {
                    sessionId: s.id,
                    sessionName: s.name,
                    startsAt: s.startsAt,
                    teacher: s.teacher,
                    location: s.location,
                    booked: s.booked ?? 0,
                    capacity: s.capacity ?? 0,
                  },
                };
                if (multi) toggle(`s${s.id}`, r);
                else onPick(r);
              }}
            />
          ))}

        {!staticRows && kind === "attendees" &&
          (visibleRows as AttendeeRow[])
            .filter((a) => !q || `${a.name} ${a.email ?? ""}`.toLowerCase().includes(q.toLowerCase()))
            .map((a) => (
              <Row
                key={`${a.sessionId}-${a.memberId}`}
                primary={a.name || `Member ${a.memberId}`}
                secondary={`${a.sessionName}${a.cancelled ? " · cancelled" : a.checkedIn ? " · checked in" : " · booked"}`}
                checked={Boolean(chosen[`a${a.sessionId}-${a.memberId}`])}
                onClick={() =>
                  toggle(`a${a.sessionId}-${a.memberId}`, {
                    value: `ans:member|${a.name}`,
                    label: a.name || `Member ${a.memberId}`,
                    meta: { memberId: a.memberId, email: a.email, phone: a.phone, sessionId: a.sessionId },
                  })
                }
              />
            ))}

        {!loading && !staticRows && visibleRows.length === 0 && (
          <div className="px-2 py-3 text-[11.5px] txt-3">
            No matches{q ? ` for "${q}"` : ""}. Type and press enter to use free text.
          </div>
        )}

        {q.trim() && (kind === "member" || kind === "trainer") && (
          <Row
            primary={`Use "${q.trim()}" as typed`}
            onClick={() => onPick({ value: `ans:${kind}|${q.trim()}`, label: q.trim() })}
          />
        )}
      </div>

      {multi && (
        <div className="mt-1.5 flex items-center gap-2 border-t pt-1.5 hairline">
          <span className="text-[10.5px] txt-3">
            {Object.keys(chosen).length
              ? `${Object.keys(chosen).length} selected`
              : kind === "sessions"
                ? "Tick every class the problem hit"
                : "Tick anyone affected"}
          </span>
          <button
            disabled={!Object.keys(chosen).length}
            onClick={() => onConfirm?.(Object.values(chosen))}
            className="btn btn-primary ml-auto !py-1 !text-[11px] disabled:opacity-40"
          >
            {kind === "sessions" ? "Confirm classes" : "Confirm members"}
          </button>
          <button
            onClick={() => onConfirm?.([])}
            className="btn btn-ghost !py-1 !text-[11px]"
          >
            {kind === "sessions" ? "None of these" : "Nobody specific"}
          </button>
        </div>
      )}
    </div>
  );
}
