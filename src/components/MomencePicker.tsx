"use client";

import { useEffect, useMemo, useState } from "react";
import type { Studio } from "@/db/schema";
import { MEMBERSHIPS } from "@/lib/catalog";
import { apiFetch } from "@/lib/api-client";

export type PickerKind = "member" | "session" | "private-session" | "trainer" | "studio" | "membership";

export type PickResult = {
  value: string;
  label: string;
  meta?: Record<string, string | number | null>;
};

type MemberRow = { id: number; name: string; email: string | null; phone: string | null; visits: number };
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

export default function MomencePicker({
  kind,
  studios = [],
  onPick,
  compact = false,
  autoFocus = true,
}: {
  kind: PickerKind;
  studios?: Studio[];
  onPick: (r: PickResult) => void;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (kind === "studio" || kind === "membership") return;
    setLoading(true);
    const resource =
      kind === "member" ? "members" : kind === "trainer" ? "directory" : kind === "private-session" ? "private-sessions" : "sessions";
    const t = setTimeout(() => {
      apiFetch<Record<string, unknown[]>>(
        `/api/momence?resource=${resource}&q=${encodeURIComponent(q)}&days=${kind === "private-session" ? 150 : 14}`,
      )
        .then((d) => {
          setRows(d.members ?? d.sessions ?? d.trainers ?? []);
        })
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 240);
    return () => clearTimeout(t);
  }, [kind, q]);

  const staticRows = useMemo(() => {
    if (kind === "studio") {
      return studios
        .filter((s) => !q || `${s.name} ${s.city}`.toLowerCase().includes(q.toLowerCase()))
        .map((s) => ({ id: s.id, primary: s.name, secondary: s.city, value: `studio:${s.id}:${s.name}, ${s.city}` }));
    }
    if (kind === "membership") {
      return MEMBERSHIPS.filter((m) => !q || m.toLowerCase().includes(q.toLowerCase())).map((m, i) => ({
        id: i,
        primary: m,
        secondary: m.split(" ")[0],
        value: `membership:${m}`,
      }));
    }
    return null;
  }, [kind, studios, q]);

  const Row = ({
    primary,
    secondary,
    right,
    onClick,
  }: {
    primary: string;
    secondary?: string;
    right?: string;
    onClick: () => void;
  }) => (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--surface-3)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium txt">{primary}</span>
        {secondary && <span className="block truncate text-[10.5px] txt-3">{secondary}</span>}
      </span>
      {right && <span className="shrink-0 text-[10px] tabular txt-3">{right}</span>}
    </button>
  );

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
          (rows as MemberRow[]).map((m) => (
            <Row
              key={m.id}
              primary={m.name || m.email || `Member ${m.id}`}
              secondary={[m.email, m.phone].filter(Boolean).join(" · ")}
              right={`${m.visits} visits`}
              onClick={() =>
                onPick({
                  value: `member:${m.id}:${m.name}`,
                  label: m.name,
                  meta: { memberId: m.id, email: m.email, phone: m.phone, visits: m.visits },
                })
              }
            />
          ))}

        {!staticRows && kind === "trainer" &&
          (rows as { id: number; name: string }[])
            .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
            .slice(0, 40)
            .map((t) => (
              <Row key={t.id} primary={t.name} onClick={() => onPick({ value: `trainer:${t.name}`, label: t.name, meta: { teacherId: t.id } })} />
            ))}

        {!staticRows && (kind === "session" || kind === "private-session") &&
          (rows as SessionRow[]).map((s) => (
            <Row
              key={`${s.id}-${s.startsAt}`}
              primary={s.name}
              secondary={`${fmt(s.startsAt)}${s.teacher ? ` · ${s.teacher}` : ""}${s.location ? ` · ${s.location}` : ""}`}
              right={s.capacity ? `${s.booked ?? 0}/${s.capacity}` : undefined}
              onClick={() =>
                onPick({
                  value: `session:${s.id}:${s.name}|${fmt(s.startsAt)}|${s.teacher ?? ""}`,
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
                })
              }
            />
          ))}

        {!loading && !staticRows && rows.length === 0 && (
          <div className="px-2 py-3 text-[11.5px] txt-3">
            No matches{q ? ` for "${q}"` : ""}. Type and press enter to use free text.
          </div>
        )}

        {q.trim() && (kind === "member" || kind === "trainer") && (
          <Row
            primary={`Use "${q.trim()}" as typed`}
            onClick={() => onPick({ value: `${kind}:${q.trim()}`, label: q.trim() })}
          />
        )}
      </div>
    </div>
  );
}
