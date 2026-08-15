import type { Ticket } from "@/db/schema";

const OPEN_STATUSES = ["Open", "In Progress", "Awaiting Info"];

export const hrs = (a: Date | string, b: Date | string) =>
  (new Date(b).getTime() - new Date(a).getTime()) / 3600000;

export const r1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function isOpen(t: Ticket) {
  return OPEN_STATUSES.includes(t.status);
}
export function isClosed(t: Ticket) {
  return t.status === "Resolved" || t.status === "Closed";
}
export function breached(t: Ticket) {
  if (!t.slaDueAt) return false;
  const due = new Date(t.slaDueAt).getTime();
  if (isClosed(t) && t.resolvedAt) return new Date(t.resolvedAt).getTime() > due;
  return !isClosed(t) && due < Date.now();
}
export function ageHours(t: Ticket) {
  return r1(hrs(t.createdAt, t.resolvedAt ?? new Date()));
}

export function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item) || "—";
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export type ReportColumn = { key: string; label: string; numeric?: boolean; width?: string };
export type ReportRow = Record<string, string | number>;

export function aggRows(map: Map<string, Ticket[]>, dimKey: string): ReportRow[] {
  return [...map.entries()]
    .map(([dim, rows]) => {
      const closed = rows.filter((t) => t.resolvedAt);
      const avg = closed.length ? r1(closed.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closed.length) : 0;
      return {
        [dimKey]: dim,
        total: rows.length,
        open: rows.filter(isOpen).length,
        resolved: rows.filter(isClosed).length,
        critical: rows.filter((t) => t.priority === "Critical").length,
        breached: rows.filter(breached).length,
        slaPct: pct(closed.length - closed.filter(breached).length, closed.length || 1),
        avgHours: avg,
        avgUrgency: Math.round(rows.reduce((s, t) => s + t.urgencyScore, 0) / rows.length),
      } as ReportRow;
    })
    .sort((a, b) => Number(b.total) - Number(a.total));
}

export const AGG_COLS = (dimKey: string, dimLabel: string): ReportColumn[] => [
  { key: dimKey, label: dimLabel },
  { key: "total", label: "Total", numeric: true },
  { key: "open", label: "Open", numeric: true },
  { key: "resolved", label: "Resolved", numeric: true },
  { key: "critical", label: "Critical", numeric: true },
  { key: "breached", label: "Breached", numeric: true },
  { key: "slaPct", label: "SLA %", numeric: true },
  { key: "avgHours", label: "Avg hrs", numeric: true },
  { key: "avgUrgency", label: "Avg urgency", numeric: true },
];

export function dayKey(d: Date | string) {
  return new Date(d).toISOString().slice(0, 10);
}
