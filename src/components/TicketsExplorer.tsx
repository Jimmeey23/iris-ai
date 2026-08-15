"use client";

import { useEffect, useMemo, useState } from "react";
import type { Staff, Studio, Ticket } from "@/db/schema";
import { CATEGORIES, CATEGORY_META, PRIORITIES, STATUSES } from "@/lib/taxonomy";
import { DEPARTMENTS } from "@/lib/org";
import TicketRow from "./TicketRow";
import { EmptyState } from "./ui";

const OPEN = ["Open", "In Progress", "Awaiting Info"];
const TABS = ["all", "open", ...STATUSES.filter((s) => s !== "Open")];
const PAGE_SIZE = 50;

type GroupBy = "none" | "status" | "studio" | "assignee" | "category" | "priority";

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "status", label: "Status" },
  { value: "studio", label: "Studio" },
  { value: "assignee", label: "Assignee" },
  { value: "category", label: "Category" },
  { value: "priority", label: "Priority" },
];

function groupKeyFor(groupBy: GroupBy, t: Ticket): string {
  switch (groupBy) {
    case "status":
      return t.status;
    case "studio":
      return t.studioName || "Not studio specific";
    case "assignee":
      return t.assigneeName || "Unassigned";
    case "category":
      return t.category;
    case "priority":
      return t.priority;
    default:
      return "";
  }
}

export default function TicketsExplorer({
  tickets,
  studios,
  staff,
  initial,
}: {
  tickets: Ticket[];
  studios: Studio[];
  staff: Staff[];
  initial: { status?: string; priority?: string; category?: string };
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initial.status ?? "all");
  const [category, setCategory] = useState(initial.category ?? "all");
  const [priority, setPriority] = useState(initial.priority ?? "all");
  const [studio, setStudio] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [department, setDepartment] = useState("all");
  const [sort, setSort] = useState("newest");
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const rank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const list = tickets.filter((t) => {
      if (term) {
        const hay = [
          t.ticketNumber, t.title, t.description, t.subcategory, t.category,
          t.memberName ?? "", t.assigneeName ?? "", t.studioName, t.trainerName ?? "",
        ].join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (status === "open" ? !OPEN.includes(t.status) : status !== "all" && t.status !== status) return false;
      if (category !== "all" && t.category !== category) return false;
      if (priority !== "all" && t.priority !== priority) return false;
      if (department !== "all" && t.department !== department) return false;
      if (studio !== "all" && String(t.studioId ?? "none") !== studio) return false;
      if (assignee !== "all" && String(t.assigneeId ?? "none") !== assignee) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "priority") return rank[a.priority] - rank[b.priority];
      if (sort === "urgency") return b.urgencyScore - a.urgencyScore;
      if (sort === "sla") {
        const av = a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity;
        const bv = b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity;
        return av - bv;
      }
      if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [tickets, q, status, category, priority, studio, assignee, department, sort]);

  const counts = useMemo(() => {
    const breached = filtered.filter(
      (t) => OPEN.includes(t.status) && t.slaDueAt && new Date(t.slaDueAt).getTime() < Date.now(),
    ).length;
    return { total: filtered.length, open: filtered.filter((t) => OPEN.includes(t.status)).length, breached };
  }, [filtered]);

  useEffect(() => {
    setPage(1);
  }, [q, status, category, priority, studio, assignee, department, sort, groupBy]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE),
    [filtered, clampedPage],
  );

  const groups = useMemo(() => {
    if (groupBy === "none") return null;
    const map = new Map<string, Ticket[]>();
    for (const t of filtered) {
      const key = groupKeyFor(groupBy, t);
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered, groupBy]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const reset = () => {
    setQ(""); setStatus("all"); setCategory("all"); setPriority("all");
    setStudio("all"); setAssignee("all"); setDepartment("all"); setSort("newest");
    setGroupBy("none"); setPage(1); setCollapsed(new Set());
  };

  return (
    <div className="space-y-3">
      <div className="panel rounded-2xl p-3.5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] txt-3">⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ticket, member, trainer, studio…"
              className="field !pl-8"
            />
          </div>
          <select className="field !w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_META[c].icon} {c}</option>
            ))}
          </select>
          <select className="field !w-auto" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="all">All departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.id} value={d.name}>{d.name}</option>
            ))}
          </select>
          <select className="field !w-auto" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="all">Any priority</option>
            {PRIORITIES.slice().reverse().map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className="field !w-auto" value={studio} onChange={(e) => setStudio(e.target.value)}>
            <option value="all">All studios</option>
            {studios.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
            ))}
            <option value="none">Not studio specific</option>
          </select>
          <select className="field !w-auto" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="all">Any owner</option>
            {staff.map((s) => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
            ))}
            <option value="none">Unassigned</option>
          </select>
          <select className="field !w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="priority">Priority</option>
            <option value="urgency">AI urgency</option>
            <option value="sla">SLA urgency</option>
          </select>
          <select
            className="field !w-auto"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            {GROUP_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.value === "none" ? "Group by…" : `Group by ${g.label}`}
              </option>
            ))}
          </select>
          <button onClick={reset} className="btn btn-ghost">Reset</button>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatus(tab)}
              className="pill-tab"
              data-active={status === tab}
            >
              {tab === "all" ? "All" : tab === "open" ? "Open" : tab}
            </button>
          ))}
          <span className="ml-auto text-[11.5px] txt-3">
            <strong className="font-semibold txt tabular">{counts.total}</strong> shown · {counts.open} open ·{" "}
            <span style={counts.breached ? { color: "var(--signal)", fontWeight: 600 } : undefined}>
              {counts.breached} breached
            </span>
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="panel overflow-hidden rounded-2xl">
          <EmptyState icon="⌕" title="No tickets match" body="Try clearing a filter or widening your search." />
        </div>
      ) : groups ? (
        <div className="space-y-3">
          {groups.map(([key, list]) => {
            const isCollapsed = collapsed.has(key);
            return (
              <div key={key} className="panel overflow-hidden rounded-2xl">
                <button
                  onClick={() => toggleGroup(key)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left transition hover:bg-[var(--surface-3)]"
                >
                  <span className="text-[12.5px] font-semibold txt">
                    {key} <span className="txt-3 font-normal">· {list.length}</span>
                  </span>
                  <span className="txt-3 text-[11px]">{isCollapsed ? "Show" : "Hide"}</span>
                </button>
                {!isCollapsed && (
                  <div className="divide-y hairline border-t hairline">
                    {list.map((t) => (
                      <TicketRow key={t.id} ticket={t} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel overflow-hidden rounded-2xl">
          <div className="divide-y hairline">
            {paged.map((t) => (
              <TicketRow key={t.id} ticket={t} />
            ))}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t hairline px-4 py-2.5">
              <span className="text-[11px] txt-3">
                Page {clampedPage} of {pageCount}
              </span>
              <div className="flex gap-1.5">
                <button
                  className="btn btn-ghost !px-2.5 !py-1"
                  disabled={clampedPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Prev
                </button>
                <button
                  className="btn btn-ghost !px-2.5 !py-1"
                  disabled={clampedPage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
