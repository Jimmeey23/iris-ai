import type { Ticket, TrainerEvaluation } from "@/db/schema";

const OPEN = ["Open", "In Progress", "Awaiting Info"];
const DAY = 86400000;

const isOpen = (t: Ticket) => OPEN.includes(t.status);
const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

/** Ordinary least squares on (index, value) — returns slope, intercept, r². */
export function linearFit(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };
  const xs = values.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (values[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (values[i] - pred) ** 2;
    ssTot += (values[i] - my) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot) };
}

function movingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Signal = {
  id: string;
  kind: "forecast" | "risk" | "pattern" | "anomaly" | "opportunity";
  severity: "critical" | "warning" | "info" | "positive";
  title: string;
  detail: string;
  metric?: string;
  confidence: number;
  horizon?: string;
  action?: string;
};

export type SeriesPoint = { day: string; actual: number | null; fitted: number; forecast: number | null };

export type ForecastBundle = {
  generatedAt: string;
  windowDays: number;
  volume: {
    series: SeriesPoint[];
    next7: number;
    lastWeek: number;
    changePct: number;
    trend: "rising" | "falling" | "steady";
    confidence: number;
  };
  backlog: { current: number; projected7: number; burnRatePerDay: number; daysToClear: number | null };
  slaRisk: { atRisk: Ticket[]; breachedNow: number; predictedBreaches7: number; complianceForecast: number };
  churn: { members: { name: string; tickets: number; highRisk: number; lastIssue: string; score: number }[]; total: number };
  trainers: { name: string; latest: number; avg: number; slope: number; projected: number; risk: "high" | "watch" | "stable" | "rising" }[];
  hotspots: { key: string; label: string; count: number; recent: number; velocity: number; forecast: number }[];
  seasonality: { weekday: string; avg: number; index: number }[];
  signals: Signal[];
};

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export function buildForecast(
  everyTicket: Ticket[],
  evaluations: TrainerEvaluation[],
  windowDays = 60,
  opts: { includeHistoric?: boolean } = {},
): ForecastBundle {
  const now = Date.now();
  const from = now - windowDays * DAY;

  // Archived imports carry stale SLA clocks and would swamp live operational
  // forecasts, so they inform pattern analysis but not the live queue metrics.
  const allTickets = opts.includeHistoric
    ? everyTicket
    : everyTicket.filter((t) => t.source !== "Historic import");
  const tickets = everyTicket.filter((t) => new Date(t.createdAt).getTime() >= from);
  const signals: Signal[] = [];

  /* ---------- daily volume + linear forecast ---------- */
  const days: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) days.push(dayKey(new Date(now - i * DAY)));
  const counts = days.map((d) => tickets.filter((t) => dayKey(t.createdAt) === d).length);
  const smooth = movingAverage(counts, 7);
  const fit = linearFit(smooth);

  const series: SeriesPoint[] = days.map((day, i) => ({
    day,
    actual: counts[i],
    fitted: Math.max(0, r1(fit.slope * i + fit.intercept)),
    forecast: null,
  }));
  for (let i = 0; i < 7; i++) {
    const idx = days.length + i;
    series.push({
      day: dayKey(new Date(now + (i + 1) * DAY)),
      actual: null,
      fitted: Math.max(0, r1(fit.slope * idx + fit.intercept)),
      forecast: Math.max(0, r1(fit.slope * idx + fit.intercept)),
    });
  }

  const next7 = Math.round(series.slice(-7).reduce((s, p) => s + (p.forecast ?? 0), 0));
  const lastWeek = counts.slice(-7).reduce((a, b) => a + b, 0);
  const prevWeek = counts.slice(-14, -7).reduce((a, b) => a + b, 0);
  const changePct = prevWeek > 0 ? Math.round(((lastWeek - prevWeek) / prevWeek) * 100) : 0;
  const trend = fit.slope > 0.04 ? "rising" : fit.slope < -0.04 ? "falling" : "steady";
  const volConfidence = Math.round(40 + fit.r2 * 55);

  if (trend === "rising" && next7 > lastWeek) {
    signals.push({
      id: "vol-up",
      kind: "forecast",
      severity: next7 > lastWeek * 1.3 ? "warning" : "info",
      title: `Ticket volume trending up — ~${next7} expected next week`,
      detail: `Seven-day moving average is climbing ${r1(fit.slope * 7)} tickets per week. Last week logged ${lastWeek} against ${prevWeek} the week before (${changePct >= 0 ? "+" : ""}${changePct}%).`,
      metric: `${next7} forecast`,
      confidence: volConfidence,
      horizon: "next 7 days",
      action: "Pre-brief the studio managers and check owner capacity before the weekend.",
    });
  } else if (trend === "falling") {
    signals.push({
      id: "vol-down",
      kind: "opportunity",
      severity: "positive",
      title: `Intake easing — ~${next7} expected next week`,
      detail: `Volume is trending down ${Math.abs(r1(fit.slope * 7))} per week. Good window to clear backlog and run preventive work.`,
      metric: `${next7} forecast`,
      confidence: volConfidence,
      horizon: "next 7 days",
      action: "Schedule the deferred maintenance and coaching sessions now.",
    });
  }

  /* ---------- anomaly detection ---------- */
  const baseline = counts.slice(0, -7);
  const sigma = stdDev(baseline);
  const mean = baseline.reduce((a, b) => a + b, 0) / Math.max(1, baseline.length);
  const spikes = days
    .map((d, i) => ({ d, v: counts[i] }))
    .slice(-14)
    .filter((p) => sigma > 0 && p.v > mean + 2 * sigma);
  if (spikes.length > 0) {
    const worst = spikes.sort((a, b) => b.v - a.v)[0];
    signals.push({
      id: "anomaly-spike",
      kind: "anomaly",
      severity: "warning",
      title: `Unusual spike on ${new Date(worst.d).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
      detail: `${worst.v} tickets against a ${r1(mean)} daily baseline — more than two standard deviations above normal. Check whether a single incident cascaded.`,
      metric: `${worst.v} vs ${r1(mean)}`,
      confidence: 82,
      action: "Review that day's tickets for a common root cause.",
    });
  }

  /* ---------- backlog burn-down ---------- */
  const openNow = allTickets.filter(isOpen);
  const resolvedLast14 = allTickets.filter(
    (t) => t.resolvedAt && now - new Date(t.resolvedAt).getTime() < 14 * DAY,
  ).length;
  const burnRate = r1(resolvedLast14 / 14);
  const inflow = r1(counts.slice(-14).reduce((a, b) => a + b, 0) / 14);
  const net = burnRate - inflow;
  const projected7 = Math.max(0, Math.round(openNow.length - net * 7));
  const daysToClear = net > 0.05 ? Math.ceil(openNow.length / net) : null;

  if (net < 0 && openNow.length > 5) {
    signals.push({
      id: "backlog-growing",
      kind: "risk",
      severity: openNow.length > 30 ? "critical" : "warning",
      title: `Backlog growing — ${openNow.length} open, ~${projected7} in a week`,
      detail: `Inflow is ${inflow}/day against a ${burnRate}/day resolution rate. At this pace the queue grows by ${Math.abs(r1(net * 7))} tickets per week.`,
      metric: `${projected7} projected`,
      confidence: 78,
      horizon: "next 7 days",
      action: "Rebalance the busiest owners or triage low-priority items into a weekly batch.",
    });
  } else if (daysToClear && daysToClear < 60) {
    signals.push({
      id: "backlog-clearing",
      kind: "forecast",
      severity: "positive",
      title: `Backlog clears in about ${daysToClear} days`,
      detail: `Resolving ${burnRate}/day against ${inflow}/day inflow — a net burn of ${r1(net)} tickets per day.`,
      metric: `${daysToClear}d to zero`,
      confidence: 72,
      horizon: `${daysToClear} days`,
    });
  }

  /* ---------- SLA breach prediction ---------- */
  const breachedNow = openNow.filter((t) => t.slaDueAt && new Date(t.slaDueAt).getTime() < now).length;
  const atRisk = openNow
    .filter((t) => {
      if (!t.slaDueAt) return false;
      const due = new Date(t.slaDueAt).getTime();
      return due > now && due < now + 3 * DAY;
    })
    .sort((a, b) => new Date(a.slaDueAt!).getTime() - new Date(b.slaDueAt!).getTime());

  const closed = allTickets.filter((t) => t.resolvedAt);
  const metOnTime = closed.filter(
    (t) => t.slaDueAt && new Date(t.resolvedAt!).getTime() <= new Date(t.slaDueAt).getTime(),
  ).length;
  const historicRate = closed.length > 0 ? metOnTime / closed.length : 1;
  const predictedBreaches7 = Math.round(atRisk.length * (1 - historicRate) + breachedNow * 0.35);
  const complianceForecast = Math.round(historicRate * 100);

  if (atRisk.length > 0) {
    signals.push({
      id: "sla-risk",
      kind: "risk",
      severity: predictedBreaches7 > 3 ? "critical" : "warning",
      title: `${atRisk.length} ticket${atRisk.length > 1 ? "s" : ""} due within 72 hours`,
      detail: `Based on a ${complianceForecast}% historic hit rate, roughly ${predictedBreaches7} of these are likely to breach. ${breachedNow} already have.`,
      metric: `${predictedBreaches7} likely breaches`,
      confidence: 74,
      horizon: "next 72 hours",
      action: "Escalate the oldest three to their owners this morning.",
    });
  }

  /* ---------- member churn scoring ---------- */
  const named = everyTicket.filter((t) => t.memberName && t.memberName !== "Anonymous member");
  const memberMap = new Map<string, Ticket[]>();
  for (const t of named) {
    const k = t.memberName!;
    memberMap.set(k, [...(memberMap.get(k) ?? []), t]);
  }
  const churnMembers = [...memberMap.entries()]
    .map(([name, rows]) => {
      const highRisk = rows.filter((t) => t.churnRisk === "High").length;
      const escalated = rows.filter((t) => t.sentiment === "Escalated").length;
      const openCount = rows.filter(isOpen).length;
      const recent = rows.filter((t) => now - new Date(t.createdAt).getTime() < 45 * DAY).length;
      const sorted = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const score = Math.min(
        99,
        highRisk * 26 + escalated * 18 + openCount * 12 + recent * 9 + (rows.length > 2 ? 14 : 0),
      );
      return { name, tickets: rows.length, highRisk, lastIssue: sorted[0].subcategory, score };
    })
    .filter((m) => m.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (churnMembers.length > 0) {
    const top = churnMembers[0];
    signals.push({
      id: "churn",
      kind: "risk",
      severity: top.score >= 70 ? "critical" : "warning",
      title: `${churnMembers.length} member${churnMembers.length > 1 ? "s" : ""} showing churn signals`,
      detail: `${top.name} scores highest at ${top.score}/100 across ${top.tickets} ticket${top.tickets > 1 ? "s" : ""}, most recently "${top.lastIssue}".`,
      metric: `${top.score}/100 peak`,
      confidence: 69,
      action: "Have the studio manager make a personal call before the next renewal date.",
    });
  }

  /* ---------- trainer trajectory ---------- */
  const byTrainer = new Map<string, TrainerEvaluation[]>();
  for (const e of evaluations) {
    byTrainer.set(e.trainerName, [...(byTrainer.get(e.trainerName) ?? []), e]);
  }
  const trainerRows = [...byTrainer.entries()]
    .map(([name, rows]) => {
      const sorted = [...rows].sort(
        (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
      );
      const scores = sorted.map((r) => r.scorePercent);
      const { slope } = linearFit(scores);
      const latest = scores.at(-1) ?? 0;
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      const projected = Math.max(0, Math.min(100, Math.round(latest + slope * 2)));
      const risk: "high" | "watch" | "stable" | "rising" =
        projected < 65 || latest < 65 ? "high" : slope < -2 ? "watch" : slope > 2 ? "rising" : "stable";
      return { name, latest, avg, slope: r1(slope), projected, risk };
    })
    .sort((a, b) => a.projected - b.projected);

  const declining = trainerRows.filter((t) => t.risk === "high" || t.risk === "watch");
  if (declining.length > 0) {
    const worst = declining[0];
    signals.push({
      id: "trainer-decline",
      kind: "forecast",
      severity: worst.projected < 65 ? "critical" : "warning",
      title: `${declining.length} trainer${declining.length > 1 ? "s" : ""} on a declining trajectory`,
      detail: `${worst.name} is at ${worst.latest}% and trending ${worst.slope >= 0 ? "+" : ""}${worst.slope} points per review — projecting ${worst.projected}% by the next assessment.`,
      metric: `${worst.projected}% projected`,
      confidence: 66,
      horizon: "next 2 reviews",
      action: "Book a class observation and set two focus criteria before the next review.",
    });
  }
  const rising = trainerRows.filter((t) => t.risk === "rising");
  if (rising.length > 0) {
    signals.push({
      id: "trainer-rising",
      kind: "opportunity",
      severity: "positive",
      title: `${rising.length} trainer${rising.length > 1 ? "s" : ""} improving fast`,
      detail: `${rising.map((t) => `${t.name} (+${t.slope}/review)`).slice(0, 3).join(", ")} — worth recognising and using as peer coaches.`,
      confidence: 71,
      action: "Feature them in the monthly recognition list.",
    });
  }

  /* ---------- issue hotspots with velocity ---------- */
  const hotspotMap = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const k = `${t.subcategory}||${t.studioName}`;
    hotspotMap.set(k, [...(hotspotMap.get(k) ?? []), t]);
  }
  const hotspots = [...hotspotMap.entries()]
    .map(([key, rows]) => {
      const recent = rows.filter((t) => now - new Date(t.createdAt).getTime() < 14 * DAY).length;
      const prior = rows.length - recent;
      const velocity = prior === 0 ? recent : r1((recent - prior / ((windowDays - 14) / 14)) / Math.max(1, prior / ((windowDays - 14) / 14)));
      const [sub, studio] = key.split("||");
      return {
        key,
        label: `${sub} · ${studio.split(",")[0]}`,
        count: rows.length,
        recent,
        velocity,
        forecast: Math.max(0, Math.round(recent * (1 + Math.max(-0.5, Math.min(1.5, velocity))))),
      };
    })
    .filter((h) => h.count > 1)
    .sort((a, b) => b.recent - a.recent || b.count - a.count)
    .slice(0, 8);

  const accelerating = hotspots.filter((h) => h.velocity > 0.5 && h.recent >= 2);
  if (accelerating.length > 0) {
    const top = accelerating[0];
    signals.push({
      id: "hotspot",
      kind: "pattern",
      severity: "warning",
      title: `Recurring pattern: ${top.label}`,
      detail: `${top.recent} in the last fortnight out of ${top.count} total — accelerating. Forecasting ~${top.forecast} in the next two weeks if untreated.`,
      metric: `${top.recent} recent`,
      confidence: 76,
      action: "Raise a root-cause review rather than fixing each occurrence individually.",
    });
  }

  /* ---------- weekday seasonality ---------- */
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const overall = tickets.length / 7 || 1;
  const seasonality = names.map((weekday, i) => {
    const rows = tickets.filter((t) => new Date(t.createdAt).getDay() === i);
    const avg = r1(rows.length / Math.max(1, Math.ceil(windowDays / 7)));
    return { weekday, avg, index: r1(rows.length / overall) };
  });
  const peak = [...seasonality].sort((a, b) => b.avg - a.avg)[0];
  if (peak && peak.avg > 0) {
    signals.push({
      id: "seasonality",
      kind: "pattern",
      severity: "info",
      title: `${peak.weekday} is the busiest intake day`,
      detail: `Averaging ${peak.avg} tickets per ${peak.weekday}, ${Math.round((peak.index - 1) * 100)}% above the daily mean. Staffing and manager presence should reflect that.`,
      metric: `${peak.avg}/day`,
      confidence: 80,
      action: `Ensure a duty manager is rostered every ${peak.weekday}.`,
    });
  }

  /* ---------- category concentration ---------- */
  const catCount = new Map<string, number>();
  for (const t of tickets) catCount.set(t.category, (catCount.get(t.category) ?? 0) + 1);
  const topCat = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topCat && tickets.length > 0 && topCat[1] / tickets.length > 0.3) {
    signals.push({
      id: "concentration",
      kind: "pattern",
      severity: "info",
      title: `${topCat[0]} accounts for ${Math.round((topCat[1] / tickets.length) * 100)}% of all intake`,
      detail: `${topCat[1]} of ${tickets.length} tickets in the window. A single systemic fix here would move the overall numbers more than anything else.`,
      confidence: 88,
      action: "Commission a focused review of this category with its owning department.",
    });
  }

  signals.sort((a, b) => {
    const rank = { critical: 0, warning: 1, positive: 2, info: 3 };
    return rank[a.severity] - rank[b.severity] || b.confidence - a.confidence;
  });

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    volume: { series, next7, lastWeek, changePct, trend, confidence: volConfidence },
    backlog: { current: openNow.length, projected7, burnRatePerDay: burnRate, daysToClear },
    slaRisk: { atRisk: atRisk.slice(0, 8), breachedNow, predictedBreaches7, complianceForecast },
    churn: { members: churnMembers, total: churnMembers.length },
    trainers: trainerRows,
    hotspots,
    seasonality,
    signals,
  };
}
