"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Studio } from "@/db/schema";
import { CATEGORY_META, TAXONOMY } from "@/lib/taxonomy";
import { suggestContext, type ContextTabKey } from "@/lib/smart-context";
import { useEscape } from "@/lib/use-escape";
import MomencePicker, { type PickResult } from "./MomencePicker";
import type { ComposerContext } from "@/lib/types";
import { apiFetch } from "@/lib/api-client";

const TAB_META: Record<ContextTabKey, { label: string; icon: string }> = {
  category: { label: "Category", icon: "◎" },
  studio: { label: "Studio", icon: "◈" },
  member: { label: "Member", icon: "◍" },
  class: { label: "Class", icon: "◷" },
  trainer: { label: "Trainer", icon: "◑" },
  membership: { label: "Package", icon: "◇" },
  area: { label: "Area", icon: "◐" },
  when: { label: "When", icon: "◔" },
  impact: { label: "Impact", icon: "◭" },
  priority: { label: "Priority", icon: "▲" },
  department: { label: "Team", icon: "⬡" },
  source: { label: "Source", icon: "✎" },
  tags: { label: "Tags", icon: "#" },
};

export default function ContextBar({
  studios,
  context,
  onChange,
  draftText = "",
  compact = false,
}: {
  studios: Studio[];
  context: ComposerContext;
  onChange: (next: ComposerContext) => void;
  draftText?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<ContextTabKey | null>(null);
  const [query, setQuery] = useState("");
  const [memberships, setMemberships] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEscape(!!open, () => setOpen(null));

  const suggestions = useMemo(
    () => suggestContext({ text: draftText, category: context.category, subcategory: context.subcategory }),
    [draftText, context.category, context.subcategory],
  );

  const set = useCallback(
    (patch: Partial<ComposerContext>) => onChange({ ...context, ...patch }),
    [context, onChange],
  );

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const loadMemberDetail = useCallback(async (memberId: number) => {
    try {
      const d = await apiFetch<{ memberships?: { name: string; creditsLeft: number | null }[] }>(
        `/api/momence?resource=member-detail&memberId=${memberId}`,
      );
      const names = (d.memberships ?? []).map((m) => m.name);
      setMemberships(names);
      return { names, credits: d.memberships?.[0]?.creditsLeft ?? null };
    } catch {
      return null;
    }
  }, []);

  const value = (key: ContextTabKey): string | undefined => {
    switch (key) {
      case "category": return context.subcategory ?? context.category;
      case "studio": return context.studioName?.split(",")[0];
      case "member": return context.memberName;
      case "class": return context.classInfo;
      case "trainer": return context.trainerName;
      case "membership": return context.membershipRef;
      case "area": return context.location;
      case "when": return context.occurredAt;
      case "impact": return context.impact;
      case "priority": return context.priority;
      case "department": return context.department;
      case "source": return context.source;
      case "tags": return context.tags?.length ? `${context.tags.length} tag${context.tags.length > 1 ? "s" : ""}` : undefined;
    }
  };

  const clear = (key: ContextTabKey) => {
    const map: Record<ContextTabKey, Partial<ComposerContext>> = {
      category: { category: undefined, subcategory: undefined },
      studio: { studioId: undefined, studioName: undefined },
      member: { memberName: undefined, memberId: undefined, memberContact: undefined, momenceContext: undefined },
      class: { classInfo: undefined, classAt: undefined, sessionId: undefined },
      trainer: { trainerName: undefined },
      membership: { membershipRef: undefined },
      area: { location: undefined },
      when: { occurredAt: undefined },
      impact: { impact: undefined },
      priority: { priority: undefined },
      department: { department: undefined },
      source: { source: undefined },
      tags: { tags: undefined },
    };
    set(map[key]);
  };

  const activeCount = suggestions.order.filter((t) => value(t)).length;

  const Row = ({ title, sub, onClick, active }: { title: string; sub?: string; onClick: () => void; active?: boolean }) => (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left transition hover:bg-[var(--surface-3)]"
      style={active ? { background: "var(--accent-soft)" } : undefined}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium txt">{title}</span>
        {sub && <span className="block truncate text-[10.5px] txt-3">{sub}</span>}
      </span>
      {active && <span className="text-[11px] accent-txt">✓</span>}
    </button>
  );

  const Search = (placeholder: string) => (
    <input
      autoFocus
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={placeholder}
      className="field !py-1.5 !text-[12px]"
    />
  );

  const List = ({ children }: { children: React.ReactNode }) => (
    <div className="hide-scrollbar mt-1.5 max-h-[248px] space-y-0.5 overflow-y-auto">{children}</div>
  );

  const simpleList = (
    key: ContextTabKey,
    items: string[],
    apply: (v: string) => void,
    label?: string,
  ) => {
    const filtered = query ? items.filter((i) => i.toLowerCase().includes(query.toLowerCase())) : items;
    return (
      <>
        {items.length > 8 && Search(`Filter ${label ?? TAB_META[key].label.toLowerCase()}…`)}
        {suggestions.hints.length > 0 && key === "category" && (
          <div className="mt-1.5 rounded-xl px-2.5 py-1.5 text-[10.5px] accent-soft">{suggestions.hints[0]}</div>
        )}
        <List>
          {filtered.map((item, i) => (
            <Row
              key={item}
              title={item}
              sub={i === 0 && !query && items.length > 3 ? "Suggested" : undefined}
              active={value(key) === item}
              onClick={() => {
                apply(item);
                setOpen(null);
                setQuery("");
              }}
            />
          ))}
          {filtered.length === 0 && <div className="px-2 py-3 text-[11.5px] txt-3">No matches.</div>}
        </List>
      </>
    );
  };

  const panel = useMemo(() => {
    if (!open) return null;
    const opts = suggestions.options;

    switch (open) {
      case "member":
        return (
          <MomencePicker
            kind="member"
            studios={studios}
            compact
            onPick={async (r: PickResult) => {
              const id = Number(r.meta?.memberId ?? 0);
              set({
                memberId: id || undefined,
                memberName: r.label,
                memberContact: (r.meta?.email as string) ?? (r.meta?.phone as string) ?? undefined,
                raisedFor: "On behalf of a member",
              });
              setOpen(null);
              if (id) {
                const detail = await loadMemberDetail(id);
                if (detail) {
                  onChange({
                    ...context,
                    memberId: id,
                    memberName: r.label,
                    memberContact: (r.meta?.email as string) ?? undefined,
                    raisedFor: "On behalf of a member",
                    membershipRef: detail.names[0] ?? context.membershipRef,
                    momenceContext: {
                      memberId: id,
                      memberEmail: (r.meta?.email as string) ?? undefined,
                      memberPhone: (r.meta?.phone as string) ?? undefined,
                      memberVisits: Number(r.meta?.visits ?? 0),
                      memberships: detail.names,
                      creditsLeft: detail.credits,
                    },
                  });
                }
              }
            }}
          />
        );

      case "class":
        return (
          <MomencePicker
            kind="session"
            studios={studios}
            compact
            onPick={(r) => {
              const match = studios.find(
                (st) => r.meta?.location && st.name.toLowerCase().includes(String(r.meta.location).split(",")[0].toLowerCase()),
              );
              onChange({
                ...context,
                sessionId: Number(r.meta?.sessionId ?? 0) || undefined,
                classInfo: String(r.meta?.sessionName ?? r.label),
                classAt: r.label.split(" · ").slice(1).join(" · "),
                trainerName: (r.meta?.teacher as string) ?? context.trainerName,
                studioId: match?.id ?? context.studioId,
                studioName: match ? `${match.name}, ${match.city}` : context.studioName,
                momenceContext: {
                  ...(context.momenceContext ?? {}),
                  sessionId: Number(r.meta?.sessionId ?? 0),
                  sessionName: String(r.meta?.sessionName ?? ""),
                  sessionStart: String(r.meta?.startsAt ?? ""),
                  sessionTeacher: (r.meta?.teacher as string) ?? undefined,
                  sessionLocation: (r.meta?.location as string) ?? undefined,
                },
              });
              setOpen(null);
            }}
          />
        );

      case "trainer":
        return (
          <MomencePicker
            kind="trainer"
            studios={studios}
            compact
            onPick={(r) => {
              set({ trainerName: r.label });
              setOpen(null);
            }}
          />
        );

      case "studio":
        return (
          <List>
            {studios.map((st) => (
              <Row
                key={st.id}
                title={st.name}
                sub={st.city}
                active={context.studioId === st.id}
                onClick={() => {
                  set({ studioId: st.id, studioName: `${st.name}, ${st.city}` });
                  setOpen(null);
                }}
              />
            ))}
            <Row
              title="Not studio specific"
              onClick={() => {
                set({ studioId: null, studioName: "Not studio specific" });
                setOpen(null);
              }}
            />
          </List>
        );

      case "membership": {
        const items = memberships.length > 0 ? [...new Set([...memberships, ...(opts.membership ?? [])])] : opts.membership ?? [];
        return (
          <>
            {memberships.length > 0 && (
              <div className="mb-1 rounded-xl px-2.5 py-1.5 text-[10.5px] mint-soft">
                {context.memberName}&apos;s live packages first
              </div>
            )}
            {simpleList("membership", items, (v) => set({ membershipRef: v }))}
          </>
        );
      }

      case "category": {
        if (context.category) {
          const subs = TAXONOMY[context.category] ?? [];
          const ranked = (opts.category ?? []).filter((s) => subs.includes(s));
          const ordered = [...new Set([...ranked, ...subs])];
          return (
            <>
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold txt">{CATEGORY_META[context.category]?.icon} {context.category}</span>
                <button className="text-[10.5px] accent-txt" onClick={() => set({ category: undefined, subcategory: undefined })}>
                  change
                </button>
              </div>
              {simpleList("category", ordered, (v) => set({ subcategory: v }), "subcategories")}
            </>
          );
        }
        const suggested = opts.category ?? [];
        const rest = Object.keys(CATEGORY_META).filter((c) => !suggested.includes(c));
        return (
          <>
            {suggestions.hints.length > 0 && (
              <div className="mb-1.5 rounded-xl px-2.5 py-1.5 text-[10.5px] accent-soft">{suggestions.hints[0]}</div>
            )}
            <List>
              {[...suggested, ...rest].map((c, i) => (
                <Row
                  key={c}
                  title={`${CATEGORY_META[c]?.icon ?? "•"}  ${c}`}
                  sub={i < suggested.length ? "Suggested by Iris" : CATEGORY_META[c]?.blurb}
                  onClick={() => set({ category: c })}
                />
              ))}
            </List>
          </>
        );
      }

      case "tags": {
        const bank = opts.tags ?? [];
        const chosen = context.tags ?? [];
        return (
          <List>
            {bank.map((t) => {
              const on = chosen.includes(t);
              return (
                <Row
                  key={t}
                  title={t}
                  active={on}
                  onClick={() => set({ tags: on ? chosen.filter((x) => x !== t) : [...chosen, t] })}
                />
              );
            })}
          </List>
        );
      }

      case "area": return simpleList("area", opts.area ?? [], (v) => set({ location: v }));
      case "when": return simpleList("when", opts.when ?? [], (v) => set({ occurredAt: v }));
      case "impact": return simpleList("impact", opts.impact ?? [], (v) => set({ impact: v }));
      case "priority": return simpleList("priority", opts.priority ?? [], (v) => set({ priority: v }));
      case "department": return simpleList("department", opts.department ?? [], (v) => set({ department: v }));
      case "source": return simpleList("source", opts.source ?? [], (v) => set({ source: v }));
    }
  }, [open, suggestions, studios, context, set, onChange, memberships, loadMemberDetail, query]);

  return (
    <div ref={wrapRef} className="relative">
      {open && (
        <div
          className="animate-slide-up absolute bottom-full left-0 z-40 mb-2 w-[340px] rounded-2xl p-2 sm:w-[400px]"
          style={{ background: "var(--surface)", border: "1px solid var(--line)", boxShadow: "var(--shadow-lg)" }}
        >
          <div className="mb-1.5 flex items-center gap-2 px-1">
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] txt-3">
              {TAB_META[open].label}
            </span>
            <button onClick={() => setOpen(null)} className="ml-auto text-[10px] txt-3 hover:txt">esc</button>
          </div>
          {panel}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {!compact && (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.18em] txt-3">
            Context{activeCount > 0 && <span className="accent-txt"> {activeCount}</span>}
          </span>
        )}
        <div className="hide-scrollbar flex flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
          {suggestions.order.map((key) => {
            const v = value(key);
            const isOpen = open === key;
            const suggested = suggestions.hints.length > 0 && key === "category" && !v;
            return (
              <span key={key} className="relative shrink-0">
                <button
                  onClick={() => {
                    setOpen(isOpen ? null : key);
                    setQuery("");
                  }}
                  className="chip transition"
                  style={{
                    border: `1px solid ${v || isOpen ? "var(--accent)" : "var(--line)"}`,
                    background: v ? "var(--accent-soft)" : suggested ? "var(--surface-3)" : "var(--surface)",
                    color: v ? "var(--accent)" : "var(--text-3)",
                    paddingRight: v ? "1.4rem" : undefined,
                  }}
                >
                  <span className="opacity-60">{TAB_META[key].icon}</span>
                  <span className="max-w-[136px] truncate">{v ?? TAB_META[key].label}</span>
                  {suggested && <span className="ml-0.5 h-1 w-1 rounded-full" style={{ background: "var(--accent)" }} />}
                </button>
                {v && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clear(key);
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] leading-none opacity-50 transition hover:opacity-100"
                    style={{ color: "var(--accent)" }}
                    aria-label={`Clear ${TAB_META[key].label}`}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
