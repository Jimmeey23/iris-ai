import Link from "next/link";
import TicketRow from "@/components/TicketRow";
import MetricCard from "@/components/MetricCard";
import { Avatar, BarRow, EmptyState, Panel, PageHeader, PriorityPill, slaLabel } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { getDashboardStats, listTickets, OPEN_STATUSES } from "@/lib/tickets";
import { CATEGORY_META } from "@/lib/taxonomy";
import type { Ticket } from "@/db/schema";

export const dynamic = "force-dynamic";

function AttentionCard({ ticket }: { ticket: Ticket }) {
  const sla = slaLabel(ticket.slaDueAt, ticket.status);
  const meta = CATEGORY_META[ticket.category];
  const hot = sla.breached || ticket.priority === "Critical";
  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="panel card-hover group relative overflow-hidden rounded-2xl p-3"
      style={hot ? { borderColor: "var(--danger)" } : undefined}
    >
      {hot && <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: "var(--danger)" }} />}
      <div className="flex items-start gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[13px]"
          style={{ background: "var(--surface-3)" }}
        >
          {meta?.icon ?? "•"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] font-semibold tabular txt-3">{ticket.ticketNumber}</span>
            <PriorityPill priority={ticket.priority} />
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-snug txt group-hover:accent-txt">
            {ticket.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[10px] txt-3">
            <span>{ticket.studioName.split(",")[0]}</span>
            <span className="opacity-40">·</span>
            <span className={sla.tone} suppressHydrationWarning>{sla.text}</span>
            <span className="opacity-40">·</span>
            <span className="truncate">{ticket.assigneeName ?? "Unassigned"}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  await ensureSeeded();
  const [stats, tickets] = await Promise.all([getDashboardStats(), listTickets({ limit: 300 })]);

  const now = Date.now();
  const attention = tickets
    .filter(
      (t) =>
        OPEN_STATUSES.includes(t.status) &&
        (t.priority === "Critical" ||
          t.churnRisk === "High" ||
          (t.slaDueAt && new Date(t.slaDueAt).getTime() < now + 8 * 3600000)),
    )
    .sort((a, b) => (a.slaDueAt ? new Date(a.slaDueAt).getTime() : Infinity) - (b.slaDueAt ? new Date(b.slaDueAt).getTime() : Infinity))
    .slice(0, 4);

  const recent = tickets.slice(0, 7);
  const raised = stats.byDay.map((d) => d.count);
  const resolvedTrend = stats.byDay.map((d) => d.resolved);
  const criticalTrend = stats.byDay.map((d) =>
    tickets.filter((t) => t.priority === "Critical" && new Date(t.createdAt).toISOString().slice(0, 10) === d.day).length,
  );
  const breachTrend = stats.byDay.map((d) =>
    tickets.filter((t) => t.slaDueAt && new Date(t.slaDueAt).toISOString().slice(0, 10) === d.day && new Date(t.slaDueAt).getTime() < now).length,
  );

  const closed = tickets.filter((t) => t.resolvedAt);
  const withinSla = closed.filter(
    (t) => t.slaDueAt && new Date(t.resolvedAt as Date).getTime() <= new Date(t.slaDueAt).getTime(),
  ).length;
  const slaPct = closed.length ? Math.round((withinSla / closed.length) * 100) : 100;

  const week = raised.slice(-7).reduce((a, b) => a + b, 0);
  const prevWeek = raised.slice(-14, -7).reduce((a, b) => a + b, 0);

  const maxCategory = Math.max(1, ...stats.byCategory.map((c) => c.count));
  const maxDept = Math.max(1, ...stats.byDepartment.map((d) => d.count));
  const maxWorkload = Math.max(1, ...stats.workload.map((w) => w.open));

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-5 sm:px-6">
      <PageHeader
        eyebrow="Command centre"
        title="Dashboard"
        description="Live operational pulse across every Physique 57 studio — AI-captured, auto-routed, SLA-tracked."
        action={
          <div className="flex gap-2">
            <Link href="/reports" className="btn btn-ghost">Reports</Link>
            <Link href="/templates" className="btn btn-ghost">Templates</Link>
            <Link href="/assistant" className="btn btn-primary">✦ Raise with Iris</Link>
          </div>
        }
      />

      {/* compact metric strip */}
      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Open" value={stats.open} sub={`${stats.newToday} new today`} trend={raised} chart="area" tone="accent" href="/tickets?status=open" delta={week - prevWeek} />
        <MetricCard label="Critical" value={stats.critical} sub="Same-day action" trend={criticalTrend} chart="bars" tone="danger" href="/tickets?priority=Critical" />
        <MetricCard label="Breached" value={stats.breached} sub="Past SLA target" trend={breachTrend} chart="bars" tone="danger" href="/tickets?status=open" />
        <MetricCard label="Resolved 7d" value={stats.resolvedThisWeek} sub={`${stats.avgResolutionHours}h avg cycle`} trend={resolvedTrend} chart="area" tone="mint" href="/tickets?status=Resolved" />
        <MetricCard label="SLA hit rate" value={slaPct} suffix="%" sub={`${withinSla}/${closed.length} in time`} chart="ring" ringValue={slaPct} tone={slaPct >= 85 ? "mint" : "danger"} href="/reports" />
        <MetricCard label="Churn risk" value={stats.highChurn} sub="Open, AI-flagged" trend={raised} chart="area" tone="neutral" href="/reports" />
      </div>

      <Panel
        title="Needs attention"
        subtitle="Critical, high churn risk or approaching SLA"
        action={<Link href="/tickets?status=open" className="text-[11.5px] font-medium accent-txt hover:underline">View queue →</Link>}
      >
        {attention.length === 0 ? (
          <EmptyState icon="✓" title="All clear" body="Every open ticket is within SLA and none are flagged critical." />
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            {attention.map((t) => <AttentionCard key={t.id} ticket={t} />)}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel
          title="Latest tickets"
          subtitle="Newest intake across all studios"
          padded={false}
          action={<Link href="/tickets" className="text-[11.5px] font-medium accent-txt hover:underline">Open tracker →</Link>}
        >
          <div className="divide-y hairline">
            {recent.map((t) => <TicketRow key={t.id} ticket={t} />)}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Volume" subtitle="Raised vs resolved · 14 days">
            <div className="flex h-24 items-end gap-[3px]">
              {stats.byDay.map((d, i) => {
                const max = Math.max(1, ...stats.byDay.map((x) => Math.max(x.count, x.resolved)));
                return (
                  <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex w-full flex-1 items-end gap-[2px]">
                      <div
                        className="grow-bar w-1/2 rounded-t-[3px]"
                        style={{ height: `${Math.max(4, (d.count / max) * 100)}%`, background: "var(--accent)", animationDelay: `${i * 28}ms` }}
                        title={`${d.count} raised`}
                      />
                      <div
                        className="grow-bar w-1/2 rounded-t-[3px]"
                        style={{ height: `${Math.max(3, (d.resolved / max) * 100)}%`, background: "var(--mint)", opacity: 0.8, animationDelay: `${i * 28 + 60}ms` }}
                        title={`${d.resolved} resolved`}
                      />
                    </div>
                    <span className="text-[8px] txt-3">{new Date(d.day).getDate()}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-3 text-[10px] txt-3">
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--accent)" }} /> Raised</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--mint)" }} /> Resolved</span>
            </div>
          </Panel>

          <Panel title="Department load" subtitle="Routing queue volume">
            <div className="space-y-2.5">
              {stats.byDepartment.slice(0, 6).map((d) => (
                <BarRow key={d.department} label={d.department} value={d.count} max={maxDept} caption={`${d.open} open / ${d.count}`} tone={d.open > 3 ? "signal" : "accent"} />
              ))}
            </div>
          </Panel>

          <Panel title="Top categories" subtitle="Where friction concentrates">
            <div className="space-y-2.5">
              {stats.byCategory.slice(0, 6).map((c) => (
                <BarRow key={c.category} label={`${CATEGORY_META[c.category]?.icon ?? "•"} ${c.category}`} value={c.count} max={maxCategory} caption={`${c.open} open`} />
              ))}
            </div>
          </Panel>

          <Panel title="Owner workload" subtitle="Open tickets per assignee">
            <div className="space-y-2">
              {stats.workload.map((w) => (
                <div key={w.assignee} className="flex items-center gap-2.5">
                  <Avatar name={w.assignee} size={24} />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[11.5px] font-medium txt">{w.assignee}</div>
                    <div className="truncate text-[9.5px] txt-3">{w.team}</div>
                  </div>
                  <div className="h-1 w-12 overflow-hidden rounded-full" style={{ background: "var(--surface-3)" }}>
                    <div className="grow-bar h-full rounded-full" style={{ width: `${(w.open / maxWorkload) * 100}%`, background: "var(--accent)" }} />
                  </div>
                  <span className="w-4 text-right text-[11px] font-semibold tabular txt-2">{w.open}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
