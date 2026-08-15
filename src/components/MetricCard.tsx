"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type MetricTone = "accent" | "danger" | "mint" | "neutral";

function toneVar(tone: MetricTone) {
  return tone === "danger" ? "var(--danger)" : tone === "mint" ? "var(--mint)" : tone === "neutral" ? "var(--text-3)" : "var(--accent)";
}

/** Animated count-up that respects reduced motion. */
function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function AreaSpark({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const max = Math.max(1, ...points);
  const w = 120;
  const h = 26;
  const step = w / (points.length - 1);
  const pts = points.map((p, i) => [i * step, h - (p / max) * (h - 3) - 1.5] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const lastY = pts.at(-1)![1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-[26px] w-full overflow-visible">
      <defs>
        <linearGradient id={`fill-${color.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#fill-${color.replace(/\W/g, "")})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="spark-line" />
      <circle cx={w} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

function MiniBars({ points, color }: { points: number[]; color: string }) {
  const max = Math.max(1, ...points);
  return (
    <div className="flex h-[26px] items-end gap-[2px]">
      {points.map((p, i) => (
        <div
          key={i}
          className="grow-bar flex-1 rounded-[2px]"
          style={{
            height: `${Math.max(8, (p / max) * 100)}%`,
            background: color,
            opacity: 0.35 + (p / max) * 0.65,
            animationDelay: `${i * 24}ms`,
          }}
        />
      ))}
    </div>
  );
}

function Ring({ value, color }: { value: number; color: string }) {
  const r = 12;
  const c = 2 * Math.PI * r;
  const [dash, setDash] = useState(c);
  useEffect(() => {
    const t = setTimeout(() => setDash(c - (Math.min(100, value) / 100) * c), 60);
    return () => clearTimeout(t);
  }, [value, c]);
  return (
    <svg viewBox="0 0 32 32" className="h-[30px] w-[30px] -rotate-90">
      <circle cx="16" cy="16" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="4" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={dash}
        style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)" }}
      />
    </svg>
  );
}

export default function MetricCard({
  label,
  value,
  suffix,
  sub,
  delta,
  trend,
  chart = "area",
  tone = "accent",
  href,
  ringValue,
}: {
  label: string;
  value: number;
  suffix?: string;
  sub?: string;
  delta?: number;
  trend?: number[];
  chart?: "area" | "bars" | "ring" | "none";
  tone?: MetricTone;
  href?: string;
  ringValue?: number;
}) {
  const color = toneVar(tone);
  const shown = useCountUp(value);

  const body = (
    <div className="panel card-hover relative h-full overflow-hidden rounded-2xl px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] txt-3">{label}</span>
        {delta !== undefined && delta !== 0 && (
          <span
            className="chip !px-1.5 !py-0 !text-[9px]"
            style={{
              background: delta > 0 ? "var(--danger-soft)" : "var(--mint-soft)",
              color: delta > 0 ? "var(--danger)" : "var(--mint)",
            }}
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-0.5">
          <span className="animate-count serif text-[30px] leading-none tabular txt">
            {shown}
          </span>
          {suffix && <span className="text-[13px] font-semibold" style={{ color }}>{suffix}</span>}
        </div>
        {chart === "ring" && <Ring value={ringValue ?? value} color={color} />}
      </div>

      {chart !== "ring" && chart !== "none" && trend && trend.length > 1 && (
        <div className="-mx-0.5 mt-2">
          {chart === "bars" ? <MiniBars points={trend} color={color} /> : <AreaSpark points={trend} color={color} />}
        </div>
      )}

      {sub && <div className="mt-1.5 truncate text-[10.5px] txt-3">{sub}</div>}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
