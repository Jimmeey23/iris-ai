"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Panel } from "./ui";
import type { ForecastBundle, Signal } from "@/lib/forecast";
import { apiFetch } from "@/lib/api-client";

type Payload = ForecastBundle & { narrative: string; engine: string };

const WINDOWS = [
  { id: 30, label: "30D" },
  { id: 60, label: "60D" },
  { id: 90, label: "90D" },
  { id: 180, label: "6M" },
];

function sevColor(s: Signal["severity"]) {
  return s === "critical" ? "var(--danger)" : s === "warning" ? "var(--warn)" : s === "positive" ? "var(--mint)" : "var(--accent)";
}
function sevBg(s: Signal["severity"]) {
  return s === "critical" ? "var(--danger-soft)" : s === "warning" ? "var(--warn-soft)" : s === "positive" ? "var(--mint-soft)" : "var(--accent-soft)";
}
const KIND_ICON: Record<Signal["kind"], string> = {
  forecast: "◔", risk: "▲", pattern: "◈", anomaly: "◉", opportunity: "✦",
};

function ForecastChart({ series }: { series: Payload["volume"]["series"] }) {
  if (series.length < 4) return null;
  const w = 720;
  const h = 170;
  const pad = 24;
  const max = Math.max(2, ...series.map((p) => Math.max(p.actual ?? 0, p.fitted, p.forecast ?? 0)));
  const step = (w - pad * 2) / (series.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const x = (i: number) => pad + i * step;

  const actualPts = series.filter((p) => p.actual !== null);
  const splitIdx = actualPts.length - 1;
  const fittedPath = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.fitted).toFixed(1)}`).join(" ");
  const forecastPath = series
    .slice(splitIdx)
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(splitIdx + i).toFixed(1)},${y(p.forecast ?? p.fitted).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[170px] w-full overflow-visible">
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={pad} x2={w - pad} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" strokeDasharray="3 5" />
      ))}
      {/* actual bars */}
      {series.map((p, i) =>
        p.actual === null ? null : (
          <rect key={i} x={x(i) - step * 0.32} y={y(p.actual)} width={Math.max(1.5, step * 0.64)}
            height={Math.max(0, h - pad - y(p.actual))} rx="1.5"
            fill="var(--accent)" opacity="0.2" />
        ),
      )}
      {/* fitted trend */}
      <path d={fittedPath} fill="none" stroke="var(--accent)" strokeWidth="2" className="spark-line" />
      {/* forecast */}
      <path d={forecastPath} fill="none" stroke="var(--warn)" strokeWidth="2" strokeDasharray="5 4" />
      <line x1={x(splitIdx)} x2={x(splitIdx)} y1={pad - 6} y2={h - pad} stroke="var(--line-strong)" strokeDasharray="2 3" />
      <text x={x(splitIdx) + 4} y={pad - 8} style={{ fontSize: 8, fill: "var(--text-3)", letterSpacing: "0.1em" }}>
        FORECAST →
      </text>
    </svg>
  );
}

export default function SignalsBoard() {
  const [win, setWin] = useState(60);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<Payload>(`/api/signals?window=${win}`)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [win]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-24 rounded-2xl" style={{ background: "var(--surface-3)", animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    );
  }
  if (!data) return <EmptyState icon="!" title="Could not build forecasts" body="Try refreshing in a moment." />;

  const { volume, backlog, slaRisk, churn, trainers, hotspots, seasonality, signals } = data;
  const maxSeason = Math.max(1, ...seasonality.map((s) => s.avg));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg">
          {WINDOWS.map((w) => (
            <button key={w.id} data-active={win === w.id} onClick={() => setWin(w.id)}>{w.label}</button>
          ))}
        </div>
        <span className="chip chip-line">{signals.length} signals</span>
        <span className="chip accent-soft">{data.engine}</span>
        <button onClick={load} className="btn btn-ghost ml-auto !py-1.5">Recalculate</button>
      </div>

      {/* executive briefing */}
      <div className="panel overflow-hidden rounded-3xl">
        <div className="h-[3px] w-full grad-accent" />
        <div className="px-6 py-5">
          <div className="text-[9px] font-semibold uppercase tracking-[0.24em] txt-3">Executive briefing</div>
          <p className="mt-2.5 text-[14px] leading-relaxed txt">{data.narrative}</p>
          <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { l: "Forecast next 7d", v: String(volume.next7), s: `${volume.changePct >= 0 ? "+" : ""}${volume.changePct}% vs last week`, c: volume.trend === "rising" ? "var(--warn)" : volume.trend === "falling" ? "var(--mint)" : "var(--accent)" },
              { l: "Backlog in 7d", v: String(backlog.projected7), s: `${backlog.current} now · ${backlog.burnRatePerDay}/day burn`, c: backlog.projected7 > backlog.current ? "var(--danger)" : "var(--mint)" },
              { l: "Likely breaches", v: String(slaRisk.predictedBreaches7), s: `${slaRisk.atRisk.length} due in 72h`, c: slaRisk.predictedBreaches7 > 0 ? "var(--danger)" : "var(--mint)" },
              { l: "Churn watchlist", v: String(churn.total), s: "members flagged", c: churn.total > 0 ? "var(--warn)" : "var(--mint)" },
            ].map((m) => (
              <div key={m.l} className="rounded-2xl px-3.5 py-2.5" style={{ background: "var(--surface-3)" }}>
                <div className="text-[8.5px] font-semibold uppercase tracking-[0.16em] txt-3">{m.l}</div>
                <div className="serif mt-1 text-[26px] leading-none tabular" style={{ color: m.c }}>{m.v}</div>
                <div className="mt-1 text-[10px] txt-3">{m.s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* signal cards */}
      <Panel title="Predictive signals" subtitle="Ranked by severity and confidence" padded={false}>
        {signals.length === 0 ? (
          <EmptyState icon="✓" title="Nothing unusual" body="All indicators sit within their normal range." />
        ) : (
          <div className="grid gap-px sm:grid-cols-2" style={{ background: "var(--line)" }}>
            {signals.map((s, i) => (
              <div key={s.id} className="animate-rise p-4" style={{ background: "var(--surface)", animationDelay: `${i * 40}ms` }}>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-[12px]"
                    style={{ background: sevBg(s.severity), color: sevColor(s.severity) }}>
                    {KIND_ICON[s.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip !px-1.5 !text-[8.5px]" style={{ background: sevBg(s.severity), color: sevColor(s.severity) }}>
                        {s.kind}
                      </span>
                      {s.horizon && <span className="chip chip-line !text-[8.5px]">{s.horizon}</span>}
                      <span className="ml-auto text-[9px] tabular txt-3">{s.confidence}% conf.</span>
                    </div>
                    <div className="mt-1.5 text-[13px] font-semibold leading-snug txt">{s.title}</div>
                    <p className="mt-1 text-[11.5px] leading-relaxed txt-2">{s.detail}</p>
                    {s.action && (
                      <p className="mt-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed accent-soft">→ {s.action}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* volume forecast */}
      <Panel title="Volume forecast" subtitle={`${data.windowDays}-day history with 7-day projection`}
        action={<span className="chip chip-line">{volume.confidence}% model fit</span>}>
        <ForecastChart series={volume.series} />
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] txt-3">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: "var(--accent)", opacity: 0.3 }} /> Daily actual</span>
          <span className="flex items-center gap-1.5"><span className="h-[2px] w-4" style={{ background: "var(--accent)" }} /> Fitted trend</span>
          <span className="flex items-center gap-1.5"><span className="h-[2px] w-4" style={{ background: "var(--warn)" }} /> Projection</span>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* churn */}
        <Panel title="Member churn watchlist" subtitle="Composite risk score from ticket history" padded={false}>
          {churn.members.length === 0 ? (
            <EmptyState icon="◍" title="No churn signals" body="No member shows a concerning pattern." />
          ) : (
            <div className="divide-y hairline">
              {churn.members.map((m) => (
                <div key={m.name} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold tabular"
                    style={{ background: "var(--surface-3)", color: m.score >= 70 ? "var(--danger)" : m.score >= 50 ? "var(--warn)" : "var(--accent)" }}>
                    {m.score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium txt">{m.name}</div>
                    <div className="text-[10px] txt-3">{m.tickets} ticket{m.tickets > 1 ? "s" : ""} · latest: {m.lastIssue}</div>
                  </div>
                  {m.highRisk > 0 && <span className="chip danger-soft !text-[9px]">{m.highRisk} high risk</span>}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* trainer trajectory */}
        <Panel title="Trainer trajectory" subtitle="Projected score at the next assessment" padded={false}>
          {trainers.length === 0 ? (
            <EmptyState icon="◑" title="No evaluations" body="Submit assessments to build projections." />
          ) : (
            <div className="hide-scrollbar max-h-[340px] divide-y overflow-y-auto hairline">
              {trainers.slice(0, 14).map((t) => {
                const color = t.risk === "high" ? "var(--danger)" : t.risk === "watch" ? "var(--warn)" : t.risk === "rising" ? "var(--mint)" : "var(--accent)";
                return (
                  <div key={t.name} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium txt">{t.name}</div>
                      <div className="text-[10px] txt-3">avg {t.avg}% · latest {t.latest}% · {t.slope >= 0 ? "+" : ""}{t.slope}/review</div>
                    </div>
                    <span className="chip !text-[9px]" style={{ background: "var(--surface-3)", color }}>{t.risk}</span>
                    <span className="serif w-11 text-right text-[17px] tabular" style={{ color }}>{t.projected}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* hotspots */}
        <Panel title="Issue hotspots" subtitle="Recurring themes with velocity" padded={false}>
          {hotspots.length === 0 ? (
            <EmptyState icon="◈" title="No recurring patterns" body="Nothing is repeating in this window." />
          ) : (
            <div className="divide-y hairline">
              {hotspots.map((h) => (
                <div key={h.key} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium txt">{h.label}</div>
                    <div className="text-[10px] txt-3">{h.count} total · {h.recent} in last 14 days</div>
                  </div>
                  {h.velocity > 0.4 && <span className="chip warn-soft !text-[9px]">accelerating</span>}
                  <span className="text-[11px] tabular txt-2">→ {h.forecast}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* SLA + seasonality */}
        <div className="space-y-4">
          <Panel title="SLA risk queue" subtitle={`${slaRisk.complianceForecast}% historic compliance`} padded={false}>
            {slaRisk.atRisk.length === 0 ? (
              <EmptyState icon="✓" title="Nothing due soon" body="No ticket is within 72 hours of breaching." />
            ) : (
              <div className="divide-y hairline">
                {slaRisk.atRisk.map((t) => {
                  const hours = t.slaDueAt ? Math.max(0, Math.round((new Date(t.slaDueAt).getTime() - Date.now()) / 3600000)) : 0;
                  return (
                    <Link key={t.id} href={`/tickets/${t.id}`} className="row-reveal flex items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--surface-3)]">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium txt">{t.title}</div>
                        <div className="text-[10px] txt-3">{t.ticketNumber} · {t.assigneeName ?? "unassigned"}</div>
                      </div>
                      <span className="chip !text-[9px]" style={{ background: hours < 12 ? "var(--danger-soft)" : "var(--warn-soft)", color: hours < 12 ? "var(--danger)" : "var(--warn)" }}>
                        {hours}h left
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title="Weekday pattern" subtitle="Where intake concentrates">
            <div className="space-y-2">
              {seasonality.map((s) => (
                <div key={s.weekday} className="flex items-center gap-2.5">
                  <span className="w-[70px] shrink-0 text-[11px] txt-2">{s.weekday.slice(0, 3)}</span>
                  <span className="h-[6px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
                    <span className="grow-bar block h-full rounded-full"
                      style={{ width: `${Math.max(3, (s.avg / maxSeason) * 100)}%`, background: s.index > 1.15 ? "var(--warn)" : "var(--accent)" }} />
                  </span>
                  <span className="w-9 text-right text-[10.5px] tabular txt-3">{s.avg}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
