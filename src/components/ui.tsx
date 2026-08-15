import Link from "next/link";
import type { ReactNode } from "react";
import { CATEGORY_META } from "@/lib/taxonomy";

/* ---------- tone helpers: only accent / mint / signal ---------- */

export function priorityTone(priority: string): { cls: string; dot: string } {
  switch (priority) {
    case "Critical":
      return { cls: "signal-soft", dot: "var(--signal)" };
    case "High":
      return { cls: "signal-soft", dot: "var(--signal)" };
    case "Medium":
      return { cls: "accent-soft", dot: "var(--accent)" };
    default:
      return { cls: "mint-soft", dot: "var(--mint)" };
  }
}

export function statusTone(status: string): string {
  switch (status) {
    case "Open":
      return "accent-soft";
    case "In Progress":
      return "accent-soft";
    case "Awaiting Info":
      return "signal-soft";
    case "Resolved":
    case "Closed":
      return "mint-soft";
    default:
      return "surface-3 txt-2";
  }
}

export function PriorityPill({ priority, dense = false }: { priority: string; dense?: boolean }) {
  const tone = priorityTone(priority);
  return (
    <span className={`chip ${tone.cls}`} style={{ opacity: priority === "High" ? 0.95 : 1 }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.dot }} />
      {dense ? priority.slice(0, 4) : priority}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`chip ${statusTone(status)}`}>{status}</span>;
}

export function CategoryChip({
  category,
  subcategory,
  minimal = false,
}: {
  category: string;
  subcategory?: string;
  minimal?: boolean;
}) {
  const meta = CATEGORY_META[category];
  return (
    <span className="chip chip-line">
      <span className="opacity-70">{meta?.icon ?? "•"}</span>
      <span className="max-w-[240px] truncate">
        {minimal ? (subcategory ?? category) : subcategory ? `${category} · ${subcategory}` : category}
      </span>
    </span>
  );
}

export function Avatar({
  name,
  color,
  size = 32,
  ring = false,
}: {
  name: string | null;
  color?: string;
  size?: number;
  ring?: boolean;
}) {
  const initials = (name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        background: color
          ? `linear-gradient(140deg, ${color}, ${color}bb)`
          : "linear-gradient(140deg, var(--accent), var(--accent))",
        width: size,
        height: size,
        fontSize: size * 0.36,
        boxShadow: ring ? "0 0 0 2px var(--surface), 0 0 0 3px var(--line)" : undefined,
      }}
    >
      {initials || "?"}
    </span>
  );
}

export function Sparkline({ points, color }: { points: number[]; color?: string }) {
  const max = Math.max(1, ...points);
  const w = 100;
  const h = 28;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (p / max) * (h - 4) - 2).toFixed(1)}`)
    .join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  const stroke = color ?? "var(--accent)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full">
      <path d={area} fill={stroke} opacity="0.1" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatCard({
  label,
  value,
  sub,
  trend,
  tone = "accent",
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number[];
  tone?: "accent" | "mint" | "signal" | "neutral";
  href?: string;
}) {
  const color =
    tone === "mint" ? "var(--mint)" : tone === "signal" ? "var(--signal)" : tone === "neutral" ? "var(--text-3)" : "var(--accent)";
  const inner = (
    <div className="panel card-hover h-full rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] txt-3">{label}</span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      </div>
      <div className="mt-2.5 text-[30px] font-semibold leading-none tracking-[-0.02em] txt tabular">{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] txt-3">{sub}</div>}
      {trend && trend.length > 1 && (
        <div className="-mx-1 mt-2">
          <Sparkline points={trend} color={color} />
        </div>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`panel rounded-2xl ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b px-5 py-3.5 hairline">
          <div className="min-w-0">
            <h2 className="serif text-[17px] leading-none txt">{title}</h2>
            {subtitle && <p className="mt-1.5 text-[9px] uppercase tracking-[0.18em] txt-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function BarRow({
  label,
  value,
  max,
  caption,
  tone = "accent",
}: {
  label: string;
  value: number;
  max: number;
  caption?: string;
  tone?: "accent" | "mint" | "signal";
}) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  const color = tone === "mint" ? "var(--mint)" : tone === "signal" ? "var(--signal)" : "var(--accent)";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="truncate text-[11.5px] txt-2">{label}</span>
        <span className="shrink-0 text-[10px] tabular txt-3">{caption ?? value}</span>
      </div>
      <div className="h-[5px] w-full overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function timeAgo(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function slaLabel(due: string | Date | null, status: string): { text: string; tone: string; breached: boolean } {
  if (status === "Resolved" || status === "Closed")
    return { text: "Completed", tone: "txt-3", breached: false };
  if (!due) return { text: "No SLA", tone: "txt-3", breached: false };
  const date = typeof due === "string" ? new Date(due) : due;
  const hours = (date.getTime() - Date.now()) / 3600000;
  if (hours < 0) {
    const over = Math.abs(Math.round(hours));
    return {
      text: `${over < 24 ? `${over}h` : `${Math.round(over / 24)}d`} overdue`,
      tone: "text-[var(--signal)]",
      breached: true,
    };
  }
  if (hours < 8) return { text: `${Math.max(1, Math.round(hours))}h left`, tone: "text-[var(--signal)]", breached: false };
  if (hours < 24) return { text: `${Math.round(hours)}h left`, tone: "txt-2", breached: false };
  return { text: `${Math.round(hours / 24)}d left`, tone: "txt-3", breached: false };
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] accent-txt">{eyebrow}</div>
        )}
        <h2 className="serif mt-2 text-[30px] leading-none txt sm:text-[34px]">{title}</h2>
        {description && <p className="mt-2.5 max-w-2xl text-[12.5px] leading-relaxed txt-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, icon = "◎" }: { title: string; body: string; icon?: string }) {
  return (
    <div className="px-6 py-16 text-center">
      <div
        className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl text-[18px] txt-3"
        style={{ background: "var(--surface-3)" }}
      >
        {icon}
      </div>
      <p className="serif mt-3 text-[17px] txt">{title}</p>
      <p className="mt-1 text-[12.5px] txt-3">{body}</p>
    </div>
  );
}
