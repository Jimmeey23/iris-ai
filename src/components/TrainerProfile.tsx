"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClassFeedback, Ticket, Trainer, TrainerEvaluation } from "@/db/schema";
import { bandTone } from "@/lib/trainer-eval";
import { download, toPng } from "@/lib/chat-export";
import { useEscape } from "@/lib/use-escape";
import { Avatar, EmptyState, PriorityPill, StatusPill, timeAgo } from "./ui";
import { apiFetch } from "@/lib/api-client";

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function Section({
  index,
  title,
  subtitle,
  action,
  children,
}: {
  index: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel overflow-hidden rounded-2xl">
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5 hairline">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold accent-soft"
          aria-hidden
        >
          {index}
        </span>
        <div className="min-w-0">
          <h2 className="serif text-[18px] leading-none txt">{title}</h2>
          {subtitle && <p className="mt-1.5 text-[9px] uppercase tracking-[0.18em] txt-3">{subtitle}</p>}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ScoreDial({ value, size = 96 }: { value: number; size?: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color =
    value >= 90 ? "var(--mint)" : value >= 80 ? "var(--accent)" : value >= 65 ? "var(--warn)" : "var(--danger)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="7" />
        <circle
          cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.min(100, value) / 100) * c}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="serif text-[24px] leading-none tabular txt">{value}</span>
        <span className="text-[8px] uppercase tracking-[0.16em] txt-3">score</span>
      </div>
    </div>
  );
}

function TrendChart({
  points, selectedId, onSelect,
}: { points: { id: number; at: string; score: number; band: string }[]; selectedId?: number | null; onSelect?: (id: number) => void }) {
  if (points.length < 2) {
    return <div className="py-8 text-center text-[11.5px] txt-3">Two or more reviews are needed to plot a trend.</div>;
  }
  const w = 640;
  const h = 150;
  const pad = 22;
  const step = (w - pad * 2) / (points.length - 1);
  const y = (s: number) => h - pad - (s / 100) * (h - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[150px] w-full overflow-visible">
      {[100, 90, 80, 65, 50].map((g) => (
        <g key={g}>
          <line x1={pad} x2={w - pad} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray="3 5" />
          <text x={4} y={y(g) + 3} className="tabular" style={{ fontSize: 8, fill: "var(--text-3)" }}>{g}</text>
        </g>
      ))}
      <line x1={pad} x2={w - pad} y1={y(65)} y2={y(65)} stroke="var(--danger)" strokeOpacity="0.4" strokeDasharray="4 3" />
      <path d={`${path} L${(pad + (points.length - 1) * step).toFixed(1)},${h - pad} L${pad},${h - pad} Z`} fill="var(--accent)" opacity="0.08" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" className="spark-line" />
      {points.map((p, i) => {
        const active = p.id === selectedId;
        return (
          <g key={i} onClick={() => onSelect?.(p.id)} style={{ cursor: onSelect ? "pointer" : undefined }}>
            <circle cx={pad + i * step} cy={y(p.score)} r={active ? 5 : 3.5} fill={active ? "var(--accent)" : "var(--surface)"} stroke="var(--accent)" strokeWidth="2" />
            <text x={pad + i * step} y={y(p.score) - 9} textAnchor="middle" className="tabular" style={{ fontSize: 9, fill: active ? "var(--accent)" : "var(--text)", fontWeight: 600 }}>
              {p.score}
            </text>
            <text x={pad + i * step} y={h - 6} textAnchor="middle" style={{ fontSize: 8, fill: "var(--text-3)" }}>
              {new Date(p.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function RubricBar({ category, score, weightage, pct }: { category: string; score: number; weightage: number; pct: number }) {
  const color = pct >= 80 ? "var(--mint)" : pct >= 65 ? "var(--accent)" : "var(--danger)";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="truncate text-[11.5px] txt-2">{category}</span>
        <span className="shrink-0 text-[10px] tabular txt-3">{score}/{weightage} · {pct}%</span>
      </div>
      <div className="h-[5px] w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
        <div className="grow-bar h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

function RadarChart({
  rows, benchmark, size = 300,
}: { rows: { category: string; pct: number }[]; benchmark: number; size?: number }) {
  if (rows.length < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  const n = rows.length;
  const angle = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const pt = (i: number, frac: number) => [cx + Math.cos(angle(i)) * r * frac, cy + Math.sin(angle(i)) * r * frac];
  const poly = (frac: (i: number) => number) =>
    rows.map((_, i) => pt(i, Math.max(0, Math.min(1, frac(i)))).join(",")).join(" ");

  const short = (s: string) => {
    const w = s.split(" ");
    const cut = `${w[0] ?? ""} ${w[1] ?? ""}`.trim();
    return cut.length > 16 ? `${cut.slice(0, 16)}…` : cut;
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-full max-h-[300px] w-full max-w-[300px]">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={poly(() => f)} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {rows.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />;
      })}
      <polygon points={poly(() => benchmark / 100)} fill="none" stroke="var(--text-3)" strokeWidth="1.5" strokeDasharray="4 4" />
      <polygon
        points={poly((i) => rows[i].pct / 100)}
        fill="var(--accent)"
        fillOpacity="0.16"
        stroke="var(--accent)"
        strokeWidth="2"
        className="spark-line"
      />
      {rows.map((row, i) => {
        const [x, y] = pt(i, row.pct / 100);
        return <circle key={row.category} cx={x} cy={y} r="3.5" fill={row.pct < 65 ? "var(--danger)" : "var(--accent)"} stroke="var(--surface)" strokeWidth="1.5" />;
      })}
      {rows.map((row, i) => {
        const [x, y] = pt(i, 1.22);
        return (
          <text key={row.category} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: 8.5, fill: "var(--text-3)", fontWeight: 600 }}>
            {short(row.category)}
          </text>
        );
      })}
    </svg>
  );
}

function Ticker({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="panel hide-scrollbar overflow-hidden rounded-2xl px-0 py-2.5">
      <div className="marquee flex w-max items-center gap-8 whitespace-nowrap px-4">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex items-center gap-8">
            {items.map((it, i) => (
              <span key={`${dup}-${i}`} className="flex items-center gap-2 text-[11.5px] txt-2">
                <span className="h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
                {it}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiTile({
  label, value, sub, tone, pct,
}: { label: string; value: string; sub: string; tone?: string; pct?: number }) {
  const color = tone ?? "var(--accent)";
  return (
    <div className="card-hover relative overflow-hidden rounded-2xl p-3.5" style={{ background: "var(--surface-2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] txt-3">{label}</div>
      <div className="serif mt-1 text-[22px] leading-none tabular" style={{ color }}>{value}</div>
      <div className="mt-1 truncate text-[10.5px] txt-3">{sub}</div>
      {pct !== undefined && (
        <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: "var(--surface-3)" }}>
          <div className="h-full grow-bar" style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

type Analysis = {
  headline: string;
  narrative: string;
  strengths: string[];
  priorities: string[];
  coachingPlan: { horizon: string; action: string }[];
  trajectory: string;
  risk: "high" | "watch" | "stable" | "rising";
  engine: string;
};

const PERIODS = [
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "180d", label: "6M", days: 180 },
  { id: "365d", label: "1Y", days: 365 },
  { id: "all", label: "All time", days: null },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export default function TrainerProfile({
  trainer, evaluations: allEvaluations, tickets: allTickets, classes: allClasses,
}: {
  trainer: Trainer;
  evaluations: TrainerEvaluation[];
  tickets: Ticket[];
  classes: ClassFeedback[];
}) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loadingAi, setLoadingAi] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rubricFilter, setRubricFilter] = useState<"all" | "strong" | "focus">("all");
  const [rubricSearch, setRubricSearch] = useState("");
  const [period, setPeriod] = useState<PeriodId>("all");
  const [appliedPeriod, setAppliedPeriod] = useState<PeriodId>("all");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpanded = (id: number) =>
    setExpandedIds((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const cutoff = useMemo(() => {
    const p = PERIODS.find((x) => x.id === appliedPeriod);
    if (!p || p.days == null) return null;
    return Date.now() - p.days * 86400000;
  }, [appliedPeriod]);

  /** Everything downstream reads from these — filtered by the applied reporting period. */
  const evaluations = useMemo(
    () => (cutoff ? allEvaluations.filter((e) => new Date(e.submittedAt).getTime() >= cutoff) : allEvaluations),
    [allEvaluations, cutoff],
  );
  const tickets = useMemo(
    () => (cutoff ? allTickets.filter((t) => new Date(t.createdAt).getTime() >= cutoff) : allTickets),
    [allTickets, cutoff],
  );
  const classes = useMemo(
    () => (cutoff ? allClasses.filter((c) => new Date(c.createdAt).getTime() >= cutoff) : allClasses),
    [allClasses, cutoff],
  );

  useEscape(exportOpen, () => setExportOpen(false));

  useEffect(() => {
    let alive = true;
    apiFetch<Analysis>(`/api/trainers/${trainer.id}/analysis`)
      .then((d) => alive && setAnalysis(d))
      .catch(() => {})
      .finally(() => alive && setLoadingAi(false));
    return () => {
      alive = false;
    };
  }, [trainer.id]);

  const regenerateAnalysis = () => {
    setLoadingAi(true);
    apiFetch<Analysis>(`/api/trainers/${trainer.id}/analysis?refresh=1`)
      .then((d) => setAnalysis(d))
      .catch(() => {})
      .finally(() => setLoadingAi(false));
  };

  const sorted = useMemo(
    () => [...evaluations].sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()),
    [evaluations],
  );
  const latest = sorted.at(-1);
  const avg = evaluations.length ? Math.round(evaluations.reduce((s, e) => s + e.scorePercent, 0) / evaluations.length) : 0;
  const delta = sorted.length > 1 ? sorted.at(-1)!.scorePercent - sorted.at(-2)!.scorePercent : 0;
  const best = evaluations.length ? Math.max(...evaluations.map((e) => e.scorePercent)) : 0;
  const worst = evaluations.length ? Math.min(...evaluations.map((e) => e.scorePercent)) : 0;

  const rubric = useMemo(() => {
    const map = new Map<string, { score: number; weightage: number; n: number }>();
    for (const e of evaluations) {
      for (const s of e.scores ?? []) {
        const cur = map.get(s.category) ?? { score: 0, weightage: 0, n: 0 };
        cur.score += s.score;
        cur.weightage += s.weightage;
        cur.n += 1;
        map.set(s.category, cur);
      }
    }
    return [...map.entries()]
      .map(([category, v]) => ({
        category,
        score: Math.round((v.score / v.n) * 10) / 10,
        weightage: Math.round((v.weightage / v.n) * 10) / 10,
        pct: v.weightage > 0 ? Math.round((v.score / v.weightage) * 100) : 0,
      }))
      .sort((a, b) => a.pct - b.pct);
  }, [evaluations]);

  const evaluatorBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const e of evaluations) {
      const key = e.evaluator?.trim() || "Unattributed";
      const cur = map.get(key) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += e.scorePercent;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([evaluator, v]) => ({ evaluator, count: v.count, avg: Math.round(v.total / v.count) }))
      .sort((a, b) => b.count - a.count);
  }, [evaluations]);

  const studioBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const e of evaluations) {
      const key = e.studio?.trim() || "Unspecified";
      const cur = map.get(key) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += e.scorePercent;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([studio, v]) => ({ studio, count: v.count, avg: Math.round(v.total / v.count) }))
      .sort((a, b) => b.count - a.count);
  }, [evaluations]);

  const themes = useMemo(() => {
    const tally = (pick: (e: TrainerEvaluation) => string[]) => {
      const map = new Map<string, number>();
      for (const e of evaluations) {
        for (const raw of pick(e) ?? []) {
          const key = raw.trim();
          if (!key) continue;
          map.set(key, (map.get(key) ?? 0) + 1);
        }
      }
      return [...map.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 10);
    };
    return {
      strengths: tally((e) => e.strengths ?? []),
      improvements: tally((e) => e.improvements ?? []),
    };
  }, [evaluations]);

  const selectedEval = useMemo(
    () => evaluations.find((e) => e.id === selectedId) ?? latest ?? null,
    [evaluations, selectedId, latest],
  );
  const selectedRubric = useMemo(
    () =>
      (selectedEval?.scores ?? [])
        .map((s) => ({ category: s.category, score: s.score, weightage: s.weightage, pct: s.weightage > 0 ? Math.round((s.score / s.weightage) * 100) : 0 }))
        .sort((a, b) => a.pct - b.pct),
    [selectedEval],
  );
  const strengths = useMemo(() => [...selectedRubric].filter((r) => r.pct >= 80).sort((a, b) => b.pct - a.pct).slice(0, 4), [selectedRubric]);
  const priorities = useMemo(() => selectedRubric.filter((r) => r.pct < 70).slice(0, 4), [selectedRubric]);
  const filteredRubric = useMemo(() => {
    let rows = selectedRubric;
    if (rubricFilter === "strong") rows = rows.filter((r) => r.pct >= 80);
    if (rubricFilter === "focus") rows = rows.filter((r) => r.pct < 65);
    if (rubricSearch.trim()) rows = rows.filter((r) => r.category.toLowerCase().includes(rubricSearch.trim().toLowerCase()));
    return rows;
  }, [selectedRubric, rubricFilter, rubricSearch]);

  const positives = tickets.filter((t) => t.sentiment === "Positive").length;
  const negatives = tickets.filter((t) => t.sentiment === "Negative" || t.sentiment === "Escalated").length;
  const openIssues = tickets.filter((t) => !["Resolved", "Closed"].includes(t.status));
  const now = Date.now();
  const last30 = tickets.filter((t) => now - new Date(t.createdAt).getTime() < 30 * 86400000);
  const daysSinceReview = latest ? Math.floor((now - new Date(latest.submittedAt).getTime()) / 86400000) : null;

  type Alert = { tone: "danger" | "warn" | "mint" | "accent"; title: string; body: string };
  const alerts: Alert[] = [];
  if (latest && latest.scorePercent < 65) alerts.push({ tone: "danger", title: "Coaching priority", body: `Latest weighted score is ${latest.scorePercent}%, below the 65% threshold.` });
  if (delta <= -8) alerts.push({ tone: "warn", title: `Down ${Math.abs(delta)} points`, body: "Regression since the previous assessment — review the weakest criteria." });
  if (delta >= 8) alerts.push({ tone: "mint", title: `Up ${delta} points`, body: "Clear improvement since the last review." });
  if (negatives >= 3) alerts.push({ tone: "danger", title: `${negatives} negative mentions`, body: "Member feedback is trending negative." });
  if (openIssues.length > 0) alerts.push({ tone: "accent", title: `${openIssues.length} open ticket${openIssues.length > 1 ? "s" : ""}`, body: "Feedback logged against this trainer is still being worked." });
  if (daysSinceReview !== null && daysSinceReview > 90) alerts.push({ tone: "warn", title: "Review overdue", body: `Last assessed ${daysSinceReview} days ago.` });
  if (evaluations.length === 0) alerts.push({ tone: "warn", title: "Never assessed", body: "No evaluation on file yet." });
  if (positives >= 3 && negatives === 0) alerts.push({ tone: "mint", title: "Consistently praised", body: `${positives} positive mentions, no negatives.` });

  const firstName = trainer.name.split(" ")[0];
  const tickerItems: string[] = [];
  if (evaluations.length > 0) tickerItems.push(`${firstName}: ${avg}% profile average${delta !== 0 ? ` (${delta >= 0 ? "+" : ""}${delta} vs last review)` : ""}`);
  if (evaluations.length > 0) tickerItems.push(`Best assessment on record: ${best}%`);
  if (rubric[0]) tickerItems.push(`Weakest lever: ${rubric[0].category} at ${rubric[0].pct}%`);
  if (rubric.length && rubric.at(-1)) tickerItems.push(`Strongest lever: ${rubric.at(-1)!.category} at ${rubric.at(-1)!.pct}%`);
  if (openIssues.length > 0) tickerItems.push(`${openIssues.length} open ticket${openIssues.length > 1 ? "s" : ""} awaiting resolution`);
  if (positives > 0) tickerItems.push(`${positives} positive member mention${positives > 1 ? "s" : ""} logged`);
  tickerItems.push(`${evaluations.length} assessment${evaluations.length === 1 ? "" : "s"} on file at ${trainer.homeStudio || "Physique 57"}`);

  const toneColor = (t: Alert["tone"]) => (t === "danger" ? "var(--danger)" : t === "warn" ? "var(--warn)" : t === "mint" ? "var(--mint)" : "var(--accent)");
  const toneBg = (t: Alert["tone"]) => (t === "danger" ? "var(--danger-soft)" : t === "warn" ? "var(--warn-soft)" : t === "mint" ? "var(--mint-soft)" : "var(--accent-soft)");

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = trainer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const periodLabel = PERIODS.find((p) => p.id === appliedPeriod)?.label ?? "All time";

  const reportHtml = useCallback(() => {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#5c6578;width:180px">${esc(k)}</td><td style="padding:6px 0;font-weight:500">${esc(v)}</td></tr>`;
    const photo = trainer.pictureUrl
      ? `<img src="${esc(trainer.pictureUrl)}" alt="${esc(trainer.name)}" style="width:128px;height:128px;border-radius:20px;object-fit:cover;box-shadow:0 8px 24px rgba(0,0,0,.12)"/>`
      : `<div style="width:128px;height:128px;border-radius:20px;background:linear-gradient(140deg,#005eed,#0047c9);color:#fff;display:flex;align-items:center;justify-content:center;font-size:44px;font-family:'Instrument Serif',serif">${esc(trainer.name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase())}</div>`;
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(trainer.name)} — performance report</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
 body{font-family:Outfit,system-ui,sans-serif;background:#fff;color:#0e1729;margin:0;padding:44px 24px}
 .wrap{max-width:860px;margin:0 auto}
 h1{font-family:'Instrument Serif',serif;font-weight:400;font-size:40px;margin:0 0 2px}
 h2{font-family:'Instrument Serif',serif;font-weight:400;font-size:22px;margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid #efefef}
 h3{font-size:13px;font-weight:600;margin:0 0 4px;color:#0e1729}
 .masthead{display:flex;align-items:center;gap:22px;padding-bottom:18px;border-bottom:2px solid #0e1729}
 .eyebrow{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#5c6578}
 .meta{font-size:12.5px;color:#5c6578;margin-top:6px}
 table{width:100%;border-collapse:collapse;font-size:13px}
 .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
 .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
 .tile{background:#f4f5f7;border-radius:12px;padding:10px 12px}
 .tile b{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.14em;color:#5c6578;font-weight:600}
 .tile span{font-family:'Instrument Serif',serif;font-size:22px}
 .bar{height:6px;background:#efefef;border-radius:99px;overflow:hidden;margin:4px 0 10px}
 .bar i{display:block;height:100%;border-radius:99px;background:#005eed}
 ul{padding-left:18px;font-size:13px;color:#3c4557} li{margin:4px 0}
 .callout{background:rgba(0,94,237,.07);border-radius:14px;padding:14px 16px;font-size:13px;line-height:1.65;color:#3c4557}
 .review{background:#fafafb;border:1px solid #efefef;border-radius:14px;padding:14px 16px;margin:10px 0}
 .review-head{display:flex;align-items:baseline;gap:8px;font-size:12.5px;color:#5c6578}
 .review-score{font-family:'Instrument Serif',serif;font-size:20px;color:#0e1729}
 .qa{font-size:11.5px;color:#3c4557;margin:2px 0}
 .qa b{color:#0e1729}
 .num{text-align:right}
 footer{margin-top:36px;border-top:1px solid #efefef;padding-top:12px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#5c6578}
 @media print{body{padding:0} .review{break-inside:avoid}}
</style></head><body><div class="wrap">
<div class="masthead">
${photo}
<div>
 <div class="eyebrow">Instructor performance record · ${esc(periodLabel)}</div>
 <h1>${esc(trainer.name)}</h1>
 <div class="meta">${esc(trainer.homeStudio || "Physique 57")} · ${esc(trainer.formats.join(", ") || "—")} · report generated ${stamp}</div>
</div>
</div>
<div class="grid">
 <div class="tile"><b>Average</b><span>${avg}%</span></div>
 <div class="tile"><b>Latest</b><span>${latest?.scorePercent ?? "—"}%</span></div>
 <div class="tile"><b>Reviews</b><span>${evaluations.length}</span></div>
 <div class="tile"><b>Trend</b><span>${delta >= 0 ? "+" : ""}${delta}</span></div>
</div>
${analysis ? `<h2>Executive analysis</h2><div class="callout"><strong>${esc(analysis.headline)}</strong><br/><br/>${esc(analysis.narrative)}</div>` : ""}
${analysis?.strengths.length ? `<h2>Strengths</h2><ul>${analysis.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
${analysis?.priorities.length ? `<h2>Coaching priorities</h2><ul>${analysis.priorities.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
${analysis?.coachingPlan.length ? `<h2>Development plan</h2><table>${analysis.coachingPlan.map((p) => row(p.horizon, p.action)).join("")}</table>` : ""}
<h2>Rubric attainment</h2>
${rubric.map((r) => `<div style="font-size:12px;display:flex;justify-content:space-between"><span>${esc(r.category)}</span><span>${r.score}/${r.weightage} · ${r.pct}%</span></div><div class="bar"><i style="width:${Math.max(2, r.pct)}%;background:${r.pct >= 80 ? "#067a4b" : r.pct >= 65 ? "#005eed" : "#d10202"}"></i></div>`).join("")}
<h2>Evaluator &amp; studio breakdown</h2>
<div class="grid2">
<table><tr style="color:#5c6578;font-size:10px;text-transform:uppercase;letter-spacing:.12em"><td>Evaluator</td><td>Reviews</td><td>Avg</td></tr>
${evaluatorBreakdown.map((e) => `<tr><td style="padding:5px 0">${esc(e.evaluator)}</td><td class="num">${e.count}</td><td class="num">${e.avg}%</td></tr>`).join("")}
</table>
<table><tr style="color:#5c6578;font-size:10px;text-transform:uppercase;letter-spacing:.12em"><td>Studio</td><td>Reviews</td><td>Avg</td></tr>
${studioBreakdown.map((s) => `<tr><td style="padding:5px 0">${esc(s.studio)}</td><td class="num">${s.count}</td><td class="num">${s.avg}%</td></tr>`).join("")}
</table>
</div>
<h2>Recurring feedback themes</h2>
<div class="grid2">
<div><h3>Strengths mentioned</h3><ul>${themes.strengths.length ? themes.strengths.map((t) => `<li>${esc(t.text)} <span style="color:#5c6578">(${t.count}×)</span></li>`).join("") : "<li>No recurring strengths yet.</li>"}</ul></div>
<div><h3>Improvement areas mentioned</h3><ul>${themes.improvements.length ? themes.improvements.map((t) => `<li>${esc(t.text)} <span style="color:#5c6578">(${t.count}×)</span></li>`).join("") : "<li>No recurring improvement areas yet.</li>"}</ul></div>
</div>
<h2>Assessment history — full submission log (${evaluations.length})</h2>
${[...evaluations].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()).map((e) => `<div class="review">
<div class="review-head"><span class="review-score">${e.scorePercent}%</span><span>${esc(e.band)}</span><span>·</span><span>${esc(e.template)}</span>${e.studio ? `<span>·</span><span>${esc(e.studio)}</span>` : ""}<span>·</span><span>${new Date(e.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>${e.evaluator ? `<span>·</span><span>by ${esc(e.evaluator)}</span>` : ""}</div>
${e.focusPoints ? `<p class="qa"><b>Focus points:</b> ${esc(e.focusPoints)}</p>` : ""}
${e.goals ? `<p class="qa"><b>Goals:</b> ${esc(e.goals)}</p>` : ""}
${e.comments ? `<p class="qa"><b>Comments:</b> ${esc(e.comments)}</p>` : ""}
${e.strengths?.length ? `<p class="qa"><b>Strengths:</b> ${e.strengths.map(esc).join("; ")}</p>` : ""}
${e.improvements?.length ? `<p class="qa"><b>Improvements:</b> ${e.improvements.map(esc).join("; ")}</p>` : ""}
${(e.answers ?? []).map((a) => `<p class="qa"><b>${esc(a.label)}:</b> ${esc(a.value)}</p>`).join("")}
</div>`).join("")}
<h2>Member feedback</h2>
<table>${row("Positive mentions", String(positives))}${row("Negative or escalated", String(negatives))}${row("Open tickets", String(openIssues.length))}${row("Hosted classes", String(classes.length))}</table>
<footer>Physique 57 — IRIS Ai · confidential instructor record</footer>
</div></body></html>`;
  }, [trainer, avg, latest, evaluations, delta, analysis, rubric, evaluatorBreakdown, studioBreakdown, themes, positives, negatives, openIssues.length, classes.length, stamp, periodLabel]);

  const doExport = async (kind: "pdf" | "png" | "html" | "json" | "print") => {
    setExportOpen(false);
    setExporting(kind);
    try {
      if (kind === "html") download(`${slug}-report-${stamp}.html`, reportHtml(), "text/html");
      if (kind === "json") {
        download(
          `${slug}-report-${stamp}.json`,
          JSON.stringify({ trainer, summary: { avg, latest: latest?.scorePercent, delta, best, worst }, analysis, rubric, evaluations, tickets, classes }, null, 2),
          "application/json",
        );
      }
      if (kind === "pdf" || kind === "print") {
        const win = window.open("", "_blank", "width=900,height=1100");
        if (win) {
          win.document.write(reportHtml());
          win.document.close();
          win.focus();
          setTimeout(() => win.print(), 600);
        }
      }
      if (kind === "png" && reportRef.current) {
        try {
          await toPng(reportRef.current, `${slug}-report-${stamp}.png`);
        } catch {
          download(`${slug}-report-${stamp}.html`, reportHtml(), "text/html");
        }
      }
    } finally {
      setExporting(null);
    }
  };

  const riskChip =
    analysis?.risk === "high" ? { bg: "var(--danger-soft)", c: "var(--danger)", label: "Coaching priority" }
    : analysis?.risk === "watch" ? { bg: "var(--warn-soft)", c: "var(--warn)", label: "Development watch" }
    : analysis?.risk === "rising" ? { bg: "var(--mint-soft)", c: "var(--mint)", label: "Improving" }
    : { bg: "var(--accent-soft)", c: "var(--accent)", label: "Stable" };

  return (
    <div className="space-y-4">
      {/* export bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip chip-line">Report generated {stamp}</span>
        {analysis && <span className="chip" style={{ background: riskChip.bg, color: riskChip.c }}>{riskChip.label}</span>}
        <span className="chip accent-soft">Showing: {periodLabel}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="seg">
            {PERIODS.map((p) => (
              <button key={p.id} data-active={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>
            ))}
          </div>
          <button
            onClick={() => setAppliedPeriod(period)}
            disabled={period === appliedPeriod}
            className="btn btn-solid !py-1.5 disabled:opacity-40"
          >
            Generate report
          </button>
        </div>

        <div className="relative">
          <button onClick={() => setExportOpen((o) => !o)} className="btn btn-primary" disabled={!!exporting}>
            {exporting ? "Exporting…" : "Export report"}
          </button>
          {exportOpen && (
            <>
              <button className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} aria-label="close" />
              <div className="animate-pop absolute right-0 top-full z-40 mt-2 w-[188px] rounded-2xl p-1.5"
                style={{ background: "var(--surface)", border: "1px solid var(--line)", boxShadow: "var(--shadow-lg)" }}>
                <div className="px-2 pb-1 pt-0.5 text-[9px] uppercase tracking-[0.18em] txt-3">Download as</div>
                {([["pdf", "PDF document"], ["png", "PNG image"], ["html", "HTML report"], ["json", "JSON data"], ["print", "Print"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => void doExport(k)}
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-[12px] txt-2 transition hover:bg-[var(--surface-3)] hover:txt">
                    {l}
                  </button>
                ))}
                <div className="mt-1 border-t px-2 pb-0.5 pt-1.5 text-[9px] uppercase tracking-[0.16em] txt-3 hairline">Esc to close</div>
              </div>
            </>
          )}
        </div>
      </div>

      <div ref={reportRef} className="space-y-4">
        {/* masthead */}
        <div className="panel overflow-hidden rounded-3xl">
          <div className="h-[4px] w-full grad-accent" />
          <div className="flex flex-wrap items-center gap-6 px-7 py-7" style={{ background: "linear-gradient(135deg, var(--surface-2), var(--surface))" }}>
            {trainer.pictureUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={trainer.pictureUrl} alt={trainer.name} className="h-[152px] w-[152px] shrink-0 rounded-[28px] object-cover"
                style={{ boxShadow: "inset 0 0 0 1px var(--line), var(--shadow-lg)" }} />
            ) : (
              <Avatar name={trainer.name} size={152} />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.28em] txt-3">Instructor performance record</div>
              <h1 className="serif mt-2 text-[46px] leading-none txt">{trainer.name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {trainer.homeStudio && <span className="chip chip-line">{trainer.homeStudio}</span>}
                {trainer.formats.map((f) => <span key={f} className="chip accent-soft">{f}</span>)}
                {latest && <span className={`chip ${bandTone(latest.band)}`}>{latest.band}</span>}
                {trainer.momenceTeacherId && <span className="chip chip-line">Momence #{trainer.momenceTeacherId}</span>}
                {trainer.email && <span className="chip chip-line">{trainer.email}</span>}
              </div>
            </div>
            <ScoreDial value={avg} size={112} />
          </div>
        </div>

        {/* bento KPI grid */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          <KpiTile label="Reviews" value={String(evaluations.length)} sub="Assessments on file" />
          <KpiTile label="Latest" value={latest ? `${latest.scorePercent}%` : "—"} sub={latest?.band ?? "Not yet assessed"}
            tone={latest ? (latest.scorePercent >= 80 ? "var(--mint)" : latest.scorePercent >= 65 ? "var(--accent)" : "var(--danger)") : undefined}
            pct={latest?.scorePercent} />
          <KpiTile label="Best" value={evaluations.length ? `${best}%` : "—"} sub="All-time high" tone="var(--mint)" pct={evaluations.length ? best : undefined} />
          <KpiTile label="Lowest" value={evaluations.length ? `${worst}%` : "—"} sub="All-time low" tone="var(--danger)" pct={evaluations.length ? worst : undefined} />
          <KpiTile label="Trend" value={sorted.length > 1 ? `${delta >= 0 ? "+" : ""}${delta}` : "—"} sub={sorted.length > 1 ? "vs previous review" : "Needs 2+ reviews"}
            tone={delta > 0 ? "var(--mint)" : delta < 0 ? "var(--danger)" : "var(--accent)"} />
          <KpiTile label="Last 30d" value={String(last30.length)} sub="Tickets logged" pct={last30.length ? Math.min(100, last30.length * 20) : undefined} />
        </div>

        <Ticker items={tickerItems} />

        {/* alerts */}
        {alerts.length > 0 && (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {alerts.slice(0, 6).map((a, i) => (
              <div key={a.title} className="animate-rise flex items-start gap-2.5 rounded-2xl px-3.5 py-2.5"
                style={{ background: toneBg(a.tone), animationDelay: `${i * 45}ms` }}>
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: toneColor(a.tone) }} />
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold" style={{ color: toneColor(a.tone) }}>{a.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed txt-2">{a.body}</span>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 01 — AI analysis */}
        <Section index="01" title="Executive analysis" subtitle="AI-generated once per assessment, then saved — not regenerated on every view"
          action={
            <div className="flex items-center gap-1.5">
              <span className="chip chip-line">{analysis?.engine ?? "Analysing…"}</span>
              <button onClick={regenerateAnalysis} disabled={loadingAi} className="btn btn-solid !px-2 !py-1 !text-[10.5px]">
                {loadingAi ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          }>
          {loadingAi ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <div key={i} className="shimmer h-4 rounded-lg" style={{ background: "var(--surface-3)", animationDelay: `${i * 90}ms` }} />)}
            </div>
          ) : !analysis ? (
            <EmptyState icon="◎" title="Analysis unavailable" body="Could not generate a narrative for this trainer." />
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl px-4 py-3.5" style={{ background: "var(--accent-soft)" }}>
                <div className="serif text-[19px] leading-snug accent-txt">{analysis.headline}</div>
                <p className="mt-2 text-[13px] leading-relaxed txt-2">{analysis.narrative}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="chip" style={{ background: "var(--surface)", color: "var(--accent)" }}>{analysis.trajectory}</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl p-3.5" style={{ background: "var(--surface-2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--mint)" }}>Momentum &amp; strongest signals</span>
                  </div>
                  <ul className="space-y-1.5">
                    {analysis.strengths.length === 0 ? (
                      <li className="text-[11.5px] txt-3">No standout strengths surfaced yet.</li>
                    ) : analysis.strengths.map((s) => (
                      <li key={s} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] leading-relaxed txt-2" style={{ background: "var(--surface)" }}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--mint)" }} />{s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl p-3.5" style={{ background: "var(--surface-2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--danger)" }}>Coaching attention &amp; action vectors</span>
                  </div>
                  <ul className="space-y-1.5">
                    {analysis.priorities.length === 0 ? (
                      <li className="text-[11.5px] txt-3">No coaching priorities flagged — steady performance.</li>
                    ) : analysis.priorities.map((s) => (
                      <li key={s} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] leading-relaxed txt-2" style={{ background: "var(--surface)" }}>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--danger)" }} />{s}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </Section>

        {/* 02 — development plan */}
        {analysis?.coachingPlan?.length ? (
          <Section index="02" title="Development plan" subtitle="Agreed next actions">
            <div className="grid gap-3 sm:grid-cols-3">
              {analysis.coachingPlan.map((p, i) => (
                <div key={p.horizon} className="rounded-2xl p-3.5" style={{ background: "var(--surface-3)" }}>
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full text-[8.5px] font-bold accent-soft">{i + 1}</span>
                    <span className="text-[8.5px] font-semibold uppercase tracking-[0.16em] txt-3">{p.horizon}</span>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed txt-2">{p.action}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {/* 03 — trajectory */}
        <Section index="03" title="Score trajectory" subtitle="Weighted rubric result per assessment · click a point to load it below"
          action={<span className="chip chip-line">{evaluations.length} assessments</span>}>
          <TrendChart
            points={sorted.map((e) => ({ id: e.id, at: e.submittedAt as unknown as string, score: e.scorePercent, band: e.band }))}
            selectedId={selectedEval?.id ?? null}
            onSelect={setSelectedId}
          />
        </Section>

        {/* 04 — rubric */}
        <Section index="04" title="Rubric attainment"
          subtitle={selectedEval ? `${new Date(selectedEval.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} assessment · weakest first` : "No assessment selected"}
          action={selectedEval ? <span className="chip accent-soft">{selectedEval.scorePercent}% overall</span> : undefined}>
          {selectedRubric.length === 0 ? (
            <EmptyState icon="◇" title="No rubric data" body="Submit an evaluation to populate this section." />
          ) : (
            <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="flex flex-col items-center justify-center gap-2">
                <RadarChart rows={selectedRubric} benchmark={avg} />
                <div className="flex items-center gap-3 text-[10px] txt-3">
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "var(--accent)" }} />Selected assessment</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: "var(--text-3)" }} />Profile average ({avg}%)</span>
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="seg">
                    {([["all", "All"], ["strong", "Strong ≥80%"], ["focus", "Needs focus <65%"]] as const).map(([k, l]) => (
                      <button key={k} data-active={rubricFilter === k} onClick={() => setRubricFilter(k)}>{l}</button>
                    ))}
                  </div>
                  <input value={rubricSearch} onChange={(e) => setRubricSearch(e.target.value)} placeholder="Search criteria…"
                    className="field ml-auto max-w-[180px] !py-1.5" />
                </div>
                {filteredRubric.length === 0 ? (
                  <EmptyState icon="◇" title="No matches" body="No criteria match this filter." />
                ) : (
                  <div className="space-y-3">
                    {filteredRubric.map((r) => <RubricBar key={r.category} {...r} />)}
                  </div>
                )}
              </div>
            </div>
          )}
        </Section>

        {/* 05 — member sentiment */}
        <Section index="05" title="Member sentiment" subtitle="Feedback logged against this trainer">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-2.5">
              {[
                { l: "Positive mentions", v: positives, c: "var(--mint)" },
                { l: "Negative or escalated", v: negatives, c: "var(--danger)" },
                { l: "Neutral", v: Math.max(0, tickets.length - positives - negatives), c: "var(--accent)" },
              ].map((r) => (
                <div key={r.l}>
                  <div className="mb-1 flex justify-between text-[11.5px]">
                    <span className="txt-2">{r.l}</span>
                    <span className="font-semibold tabular txt">{r.v}</span>
                  </div>
                  <div className="h-[5px] overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
                    <div className="grow-bar h-full rounded-full" style={{ width: `${tickets.length ? (r.v / tickets.length) * 100 : 0}%`, background: r.c }} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.16em] txt-3">Recurring themes</div>
              <div className="flex flex-wrap gap-1.5">
                {[...new Set(tickets.map((t) => t.subcategory))].slice(0, 10).map((s) => (
                  <span key={s} className="chip chip-line">{s}</span>
                ))}
                {tickets.length === 0 && <span className="text-[11.5px] txt-3">No feedback logged yet.</span>}
              </div>
            </div>
          </div>
        </Section>

        {/* 06 — assessment history, full submission detail for every historic review */}
        <Section index="06" title="Assessment history" subtitle="Every historic review on file for the selected period · click the score to load it into the rubric &amp; radar above"
          action={<span className="chip chip-line">{evaluations.length} on file</span>}>
          {evaluations.length === 0 ? (
            <EmptyState icon="◔" title="No evaluations" body="Fillout submissions appear here automatically." />
          ) : (
            <div className="space-y-3">
              {[...evaluations].sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()).map((e) => {
                const active = e.id === selectedEval?.id;
                const open = expandedIds.has(e.id);
                return (
                  <div
                    key={e.id}
                    className="row-reveal rounded-2xl p-3.5 transition"
                    style={{
                      background: active ? "var(--accent-soft)" : "var(--surface-3)",
                      boxShadow: active ? "inset 0 0 0 1px var(--accent-line)" : undefined,
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => setSelectedId(e.id)} className="serif text-[19px] leading-none tabular" style={{ color: active ? "var(--accent)" : "var(--text)" }}>
                        {e.scorePercent}%
                      </button>
                      <span className={`chip ${bandTone(e.band)}`}>{e.band}</span>
                      <span className="chip chip-line">{e.template}</span>
                      {e.studio && <span className="chip chip-line">{e.studio}</span>}
                      {active && <span className="chip" style={{ background: "var(--accent)", color: "#fff" }}>Active in report</span>}
                      <span className="ml-auto text-[10px] txt-3" suppressHydrationWarning>
                        {new Date(e.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        {e.evaluator ? ` · ${e.evaluator}` : ""} · {timeAgo(e.submittedAt)} ago
                      </span>
                    </div>

                    <div className="mt-2.5 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                      {e.focusPoints && <p className="text-[12px] leading-relaxed txt-2"><strong className="txt">Focus:</strong> {e.focusPoints}</p>}
                      {e.goals && <p className="text-[12px] leading-relaxed txt-2"><strong className="txt">Goals:</strong> {e.goals}</p>}
                      {e.comments && <p className="text-[12px] leading-relaxed txt-2 sm:col-span-2"><strong className="txt">Comments:</strong> {e.comments}</p>}
                    </div>

                    {(e.strengths?.length > 0 || e.improvements?.length > 0) && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {e.strengths?.map((s, i) => (
                          <span key={`s${i}`} className="chip" style={{ background: "var(--mint-soft)", color: "var(--mint)" }}>{s}</span>
                        ))}
                        {e.improvements?.map((s, i) => (
                          <span key={`i${i}`} className="chip" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>{s}</span>
                        ))}
                      </div>
                    )}

                    {e.scores?.length > 0 && (
                      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
                        {e.scores.map((s) => (
                          <div key={s.category} className="flex items-center justify-between rounded-lg px-2.5 py-1 text-[11px]" style={{ background: "var(--surface)" }}>
                            <span className="truncate txt-2">{s.category}</span>
                            <span className="tabular txt-3">{s.score}/{s.weightage}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {(e.answers?.length ?? 0) > 0 && (
                      <>
                        <button onClick={() => toggleExpanded(e.id)} className="mt-2.5 text-[11px] font-semibold accent-txt">
                          {open ? "Hide full submission ▴" : `Show full submission — all ${e.answers.length} questions ▾`}
                        </button>
                        {open && (
                          <div className="mt-2 grid gap-1.5 rounded-xl p-3 sm:grid-cols-2" style={{ background: "var(--surface)" }}>
                            {e.answers.map((a, i) => (
                              <div key={i} className="min-w-0">
                                <div className="text-[9.5px] font-semibold uppercase tracking-[0.1em] txt-3">{a.label}</div>
                                <div className="text-[11.5px] leading-snug txt-2">{a.value || "—"}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* 07 — evaluator & studio breakdown */}
        <Section index="07" title="Evaluator &amp; studio breakdown" subtitle="Who is assessing this trainer, and where">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.16em] txt-3">By evaluator</div>
              {evaluatorBreakdown.length === 0 ? (
                <p className="text-[11.5px] txt-3">No evaluations recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {evaluatorBreakdown.map((r) => (
                    <div key={r.evaluator} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: "var(--surface-3)" }}>
                      <span className="truncate text-[12px] txt-2">{r.evaluator}</span>
                      <span className="shrink-0 text-[11px] txt-3">{r.count} review{r.count === 1 ? "" : "s"} · <strong className="txt">{r.avg}%</strong> avg</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.16em] txt-3">By studio</div>
              {studioBreakdown.length === 0 ? (
                <p className="text-[11.5px] txt-3">No studio recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {studioBreakdown.map((r) => (
                    <div key={r.studio} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: "var(--surface-3)" }}>
                      <span className="truncate text-[12px] txt-2">{r.studio}</span>
                      <span className="shrink-0 text-[11px] txt-3">{r.count} review{r.count === 1 ? "" : "s"} · <strong className="txt">{r.avg}%</strong> avg</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* 08 — recurring feedback themes */}
        <Section index="08" title="Recurring feedback themes" subtitle="Phrases repeated across historic reviews, most frequent first">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--mint)" }}>Strengths mentioned</div>
              {themes.strengths.length === 0 ? (
                <p className="text-[11.5px] txt-3">No recurring strengths yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {themes.strengths.map((t) => (
                    <li key={t.text} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed txt-2" style={{ background: "var(--surface-3)" }}>
                      <span className="min-w-0 truncate">{t.text}</span>
                      <span className="shrink-0 text-[10.5px] txt-3">{t.count}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-2 text-[8.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--danger)" }}>Improvement areas mentioned</div>
              {themes.improvements.length === 0 ? (
                <p className="text-[11.5px] txt-3">No recurring improvement areas yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {themes.improvements.map((t) => (
                    <li key={t.text} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed txt-2" style={{ background: "var(--surface-3)" }}>
                      <span className="min-w-0 truncate">{t.text}</span>
                      <span className="shrink-0 text-[10.5px] txt-3">{t.count}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Section>

        {/* 09 — tickets */}
        <Section index="09" title="Feedback tickets" subtitle={`${tickets.length} logged`} >
          {tickets.length === 0 ? (
            <EmptyState icon="≡" title="No feedback tickets" body="Nothing has been logged against this trainer." />
          ) : (
            <div className="-mx-2 divide-y hairline">
              {tickets.slice(0, 12).map((t) => (
                <Link key={t.id} href={`/tickets/${t.id}`} className="row-reveal flex items-center gap-3 px-2 py-2.5 transition hover:bg-[var(--surface-3)]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium txt">{t.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] txt-3">
                      <span>{t.ticketNumber}</span><span>·</span><span>{t.subcategory}</span>
                      <span>·</span><span suppressHydrationWarning>{timeAgo(t.createdAt)} ago</span>
                    </div>
                  </div>
                  <StatusPill status={t.status} />
                  <PriorityPill priority={t.priority} />
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* 10 — hosted classes */}
        <Section index="10" title="Hosted classes" subtitle={`${classes.length} sessions`}>
          {classes.length === 0 ? (
            <EmptyState icon="◷" title="No hosted classes" body="Hosted class feedback will appear here." />
          ) : (
            <table className="rpt">
              <thead>
                <tr><th>Session</th><th>Host</th><th style={{ textAlign: "right" }}>Attendees</th>
                  <th style={{ textAlign: "right" }}>Host /5</th><th style={{ textAlign: "right" }}>Class /5</th><th>Intent</th></tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id}>
                    <td>{c.sessionName}</td><td>{c.hostName || "—"}</td>
                    <td className="num">{c.attendeeCount}</td><td className="num">{c.hostScore}</td>
                    <td className="num">{c.classScore}</td><td>{c.purchaseIntent || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <p className="pb-2 text-center text-[9px] uppercase tracking-[0.2em] txt-3">
          Physique 57 — IRIS Ai · confidential instructor record
        </p>
      </div>
    </div>
  );
}
