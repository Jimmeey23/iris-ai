"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORIES } from "@/lib/taxonomy";
import { DEPARTMENTS } from "@/lib/org";
import { EmptyState } from "./ui";
import { apiFetch, ApiError } from "@/lib/api-client";

/* Report catalogue is fetched from the API — nothing heavy in the client bundle. */
type CatalogueItem = { id: string; name: string; group: string; blurb: string };
type Column = { key: string; label: string; numeric?: boolean; width?: string };
type Row = Record<string, string | number>;
type Payload = {
  id: string;
  name: string;
  blurb: string;
  group: string;
  columns: Column[];
  rows: Row[];
  period: string;
  ticketCount: number;
};

const PERIODS = [
  { id: "7d", label: "7D" },
  { id: "14d", label: "14D" },
  { id: "30d", label: "30D" },
  { id: "90d", label: "QTR" },
  { id: "180d", label: "6M" },
  { id: "365d", label: "1Y" },
  { id: "all", label: "ALL" },
];

function Bars({ rows, columns }: { rows: Row[]; columns: Column[] }) {
  const labelKey = columns.find((c) => !c.numeric)?.key;
  const valueKey = columns.find((c) => c.numeric)?.key;
  if (!labelKey || !valueKey || rows.length === 0) return null;
  const top = [...rows]
    .filter((r) => typeof r[valueKey] === "number")
    .sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]))
    .slice(0, 8);
  if (top.length < 2) return null;
  const max = Math.max(...top.map((r) => Number(r[valueKey])), 1);
  return (
    <div className="grid gap-1.5 px-4 pb-3 pt-3.5">
      {top.map((r, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="w-[34%] truncate text-[11px] txt-2">{String(r[labelKey])}</span>
          <span className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
            <span
              className="grow-bar block h-full rounded-full"
              style={{
                width: `${Math.max(3, (Number(r[valueKey]) / max) * 100)}%`,
                background: i === 0 ? "var(--accent)" : "color-mix(in srgb, var(--accent) 62%, transparent)",
                animationDelay: `${i * 40}ms`,
              }}
            />
          </span>
          <span className="w-9 text-right text-[11px] font-semibold tabular txt">{Number(r[valueKey])}</span>
        </div>
      ))}
    </div>
  );
}

export default function ReportsWorkbench({ studios }: { studios: string[] }) {
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [reportId, setReportId] = useState("exec-summary");
  const [group, setGroup] = useState("all");
  const [period, setPeriod] = useState("30d");
  const [studio, setStudio] = useState("all");
  const [department, setDepartment] = useState("all");
  const [category, setCategory] = useState("all");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(false);
  const [q, setQ] = useState("");
  const [chart, setChart] = useState(true);
  const [catQuery, setCatQuery] = useState("");

  useEffect(() => {
    apiFetch<{ reports?: CatalogueItem[] }>("/api/reports")
      .then((d) => setCatalogue(d.reports ?? []))
      .catch(() => setCatalogue([]));
  }, []);

  const params = useMemo(
    () => new URLSearchParams({ id: reportId, period, studio, department, category }).toString(),
    [reportId, period, studio, department, category],
  );

  // Derived, exactly as in SignalsBoard: the fetch effect only writes state when
  // a response arrives, so switching report or params cannot cascade a render.
  const [loadedParams, setLoadedParams] = useState<string | null>(null);
  const loading = loadedParams !== params;
  // A new request clears the previous failure as part of rendering the new one,
  // rather than as a second render triggered from the fetch effect.
  const [errorParams, setErrorParams] = useState(params);
  if (errorParams !== params) {
    setErrorParams(params);
    setError(null);
  }

  const load = useCallback(() => {
    apiFetch<Payload>(`/api/reports?${params}`)
      .then((d) => {
        setData(d);
        setSortKey(null);
      })
      .catch((e: unknown) => {
        setData(null);
        setError(e instanceof ApiError ? e.message : (e as Error).message);
      })
      .finally(() => setLoadedParams(params));
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => [...new Set(catalogue.map((c) => c.group))], [catalogue]);
  const list = useMemo(() => {
    let rows = group === "all" ? catalogue : catalogue.filter((c) => c.group === group);
    if (catQuery.trim()) {
      const t = catQuery.toLowerCase();
      rows = rows.filter((c) => `${c.name} ${c.blurb}`.toLowerCase().includes(t));
    }
    return rows;
  }, [catalogue, group, catQuery]);

  const visible = useMemo(() => {
    if (!data) return [];
    let rows = data.rows ?? [];
    if (q.trim()) {
      const term = q.toLowerCase();
      rows = rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(term)));
    }
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
        return sortAsc
          ? String(av ?? "").localeCompare(String(bv ?? ""))
          : String(bv ?? "").localeCompare(String(av ?? ""));
      });
    }
    return rows;
  }, [data, q, sortKey, sortAsc]);

  const maxima = useMemo(() => {
    const m: Record<string, number> = {};
    if (!data) return m;
    for (const col of data.columns ?? []) {
      if (!col.numeric) continue;
      const nums = (data.rows ?? []).map((r) => (typeof r[col.key] === "number" ? (r[col.key] as number) : 0));
      m[col.key] = nums.length ? Math.max(...nums, 0) : 0;
    }
    return m;
  }, [data]);

  const active = catalogue.find((c) => c.id === reportId);

  return (
    <div className="grid gap-4 lg:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="panel h-fit rounded-2xl p-2.5">
        <div className="px-1 pb-2 text-[9px] font-semibold uppercase tracking-[0.2em] txt-3">
          Library · {catalogue.length}
        </div>
        <input value={catQuery} onChange={(e) => setCatQuery(e.target.value)} placeholder="Search reports…" className="field !py-1.5 !text-[12px]" />
        <div className="hide-scrollbar mt-2 flex gap-1 overflow-x-auto pb-1.5">
          <button className="pill-tab shrink-0 !px-2.5 !py-1 !text-[10.5px]" data-active={group === "all"} onClick={() => setGroup("all")}>All</button>
          {groups.map((g) => (
            <button key={g} className="pill-tab shrink-0 !px-2.5 !py-1 !text-[10.5px]" data-active={group === g} onClick={() => setGroup(g)}>
              {g.split(" ")[0]}
            </button>
          ))}
        </div>
        <div className="hide-scrollbar mt-1 max-h-[calc(100vh-330px)] space-y-0.5 overflow-y-auto">
          {list.map((r) => (
            <button
              key={r.id}
              onClick={() => setReportId(r.id)}
              className="w-full rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--surface-3)]"
              style={reportId === r.id ? { background: "var(--accent-soft)" } : undefined}
            >
              <span className="block truncate text-[12px] font-medium" style={{ color: reportId === r.id ? "var(--accent)" : "var(--text)" }}>
                {r.name}
              </span>
              <span className="mt-0.5 block truncate text-[10px] txt-3">{r.blurb}</span>
            </button>
          ))}
          {list.length === 0 && <div className="px-2 py-4 text-[11.5px] txt-3">No reports match.</div>}
        </div>
      </aside>

      <div className="space-y-3">
        <div className="panel rounded-2xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg">
              {PERIODS.map((p) => (
                <button key={p.id} data-active={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>
              ))}
            </div>
            <select className="field !w-auto !py-1.5" value={studio} onChange={(e) => setStudio(e.target.value)}>
              <option value="all">All studios</option>
              {studios.map((s) => <option key={s} value={s}>{s.split(",")[0]}</option>)}
            </select>
            <select className="field !w-auto !py-1.5" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="all">All teams</option>
              {DEPARTMENTS.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
            <select className="field !w-auto !py-1.5" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows…" className="field !w-[140px] !py-1.5" />
            <div className="ml-auto flex gap-1.5">
              <button onClick={() => setChart((c) => !c)} className="btn btn-ghost !py-1.5" title="Toggle chart">
                {chart ? "Hide chart" : "Show chart"}
              </button>
              <button onClick={load} className="btn btn-ghost !py-1.5">Refresh</button>
              <a href={`/api/reports?${params}&format=csv`} className="btn btn-primary !py-1.5">Export CSV</a>
            </div>
          </div>
        </div>

        <div className="panel overflow-hidden rounded-2xl">
          <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 hairline">
            <div className="min-w-0">
              <h2 className="serif truncate text-[20px] leading-none txt">{data?.name ?? active?.name ?? "Loading…"}</h2>
              <p className="mt-1.5 truncate text-[10.5px] txt-3">{data?.blurb ?? active?.blurb}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {data?.period && <span className="chip accent-soft">{data.period}</span>}
              <span className="chip chip-line">{visible.length} rows</span>
              <span className="chip chip-line">{data?.ticketCount ?? 0} tickets</span>
            </div>
          </header>

          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="shimmer h-7 rounded-lg" style={{ background: "var(--surface-3)" }} />
              ))}
            </div>
          ) : error ? (
            <div className="p-5">
              <EmptyState icon="!" title="Could not build this report" body={error} />
              <div className="mt-3 flex justify-center">
                <button onClick={load} className="btn btn-primary">Try again</button>
              </div>
            </div>
          ) : !data || visible.length === 0 ? (
            <EmptyState icon="◎" title="No data in range" body="Widen the period or clear a filter." />
          ) : (
            <>
              {chart && <Bars rows={visible} columns={data.columns} />}
              <div className="hide-scrollbar max-h-[calc(100vh-380px)] overflow-auto border-t hairline">
                <table className="rpt">
                  <thead>
                    <tr>
                      {data.columns.map((c) => (
                        <th
                          key={c.key}
                          style={{ width: c.width, textAlign: c.numeric ? "right" : "left", cursor: "pointer" }}
                          onClick={() => {
                            if (sortKey === c.key) setSortAsc((a) => !a);
                            else {
                              setSortKey(c.key);
                              setSortAsc(false);
                            }
                          }}
                        >
                          {c.label}
                          {sortKey === c.key && <span className="ml-1 accent-txt">{sortAsc ? "↑" : "↓"}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row, i) => (
                      <tr key={i} className="animate-rise" style={{ animationDelay: `${Math.min(i, 14) * 12}ms` }}>
                        {data.columns.map((c) => {
                          const v = row[c.key];
                          const max = maxima[c.key] ?? 0;
                          const showBar = c.numeric && typeof v === "number" && max > 0;
                          return (
                            <td key={c.key} className={c.numeric ? "num" : undefined}>
                              {v === undefined || v === null || v === "" ? "—" : String(v)}
                              {showBar && (
                                <span className="ml-2 inline-block h-[3px] w-9 overflow-hidden rounded-full align-middle" style={{ background: "var(--surface-3)" }}>
                                  <span
                                    className="block h-full rounded-full"
                                    style={{ width: `${Math.max(2, Math.min(100, (Number(v) / max) * 100))}%`, background: "var(--accent)" }}
                                  />
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
