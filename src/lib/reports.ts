import type { Ticket, TrainerEvaluation, ClassFeedback } from "@/db/schema";
import {
  AGG_COLS,
  aggRows,
  ageHours,
  breached,
  dayKey,
  groupBy,
  hrs,
  isClosed,
  isOpen,
  pct,
  r1,
  type ReportColumn,
  type ReportRow,
} from "./report-helpers";

export type { ReportColumn, ReportRow };

export type ReportDefinition = {
  id: string;
  name: string;
  group: ReportGroup;
  blurb: string;
  columns: ReportColumn[];
  build: (ctx: ReportContext) => ReportRow[];
  /** Optional headline stats rendered above the table. */
  summary?: (rows: ReportRow[], ctx: ReportContext) => { label: string; value: string }[];
};

export type ReportGroup =
  | "Operations"
  | "SLA & Performance"
  | "Member Experience"
  | "Trainers & Classes"
  | "Financial & Risk"
  | "Executive";

export const REPORT_GROUPS: ReportGroup[] = [
  "Executive",
  "Operations",
  "SLA & Performance",
  "Member Experience",
  "Trainers & Classes",
  "Financial & Risk",
];

export type ReportContext = {
  tickets: Ticket[];
  evaluations: TrainerEvaluation[];
  classFeedback: ClassFeedback[];
  from: Date;
  to: Date;
  label: string;
};

/* ------------------------------ reports ------------------------------ */

export const REPORTS: ReportDefinition[] = [
  {
    id: "exec-summary",
    name: "Executive summary",
    group: "Executive",
    blurb: "One-page health check across volume, SLA, sentiment and risk",
    columns: [
      { key: "metric", label: "Metric" },
      { key: "value", label: "Value", numeric: true },
      { key: "detail", label: "Detail" },
    ],
    build: ({ tickets }) => {
      const closed = tickets.filter((t) => t.resolvedAt);
      const avg = closed.length ? r1(closed.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closed.length) : 0;
      const withinSla = closed.filter((t) => !breached(t)).length;
      return [
        { metric: "Tickets raised", value: tickets.length, detail: "In selected period" },
        { metric: "Currently open", value: tickets.filter(isOpen).length, detail: `${pct(tickets.filter(isOpen).length, tickets.length || 1)}% of volume` },
        { metric: "Resolved", value: closed.length, detail: `${pct(closed.length, tickets.length || 1)}% closure rate` },
        { metric: "SLA compliance", value: `${pct(withinSla, closed.length || 1)}%`, detail: `${withinSla}/${closed.length} closed in time` },
        { metric: "Avg resolution", value: `${avg}h`, detail: "Created → resolved" },
        { metric: "Critical open", value: tickets.filter((t) => isOpen(t) && t.priority === "Critical").length, detail: "Needs same-day action" },
        { metric: "SLA breached", value: tickets.filter(breached).length, detail: "Past resolution target" },
        { metric: "High churn risk", value: tickets.filter((t) => t.churnRisk === "High").length, detail: "AI-flagged retention risk" },
        { metric: "Escalated tone", value: tickets.filter((t) => t.sentiment === "Escalated").length, detail: "Sentiment analysis" },
        { metric: "Avg urgency", value: tickets.length ? Math.round(tickets.reduce((s, t) => s + t.urgencyScore, 0) / tickets.length) : 0, detail: "AI urgency score /100" },
        { metric: "Distinct studios", value: new Set(tickets.map((t) => t.studioName)).size, detail: "Reporting activity" },
        { metric: "Distinct owners", value: new Set(tickets.map((t) => t.assigneeName).filter(Boolean)).size, detail: "Active assignees" },
      ];
    },
  },
  {
    id: "weekly-consolidated",
    name: "Weekly consolidated report",
    group: "Executive",
    blurb: "Full week-by-week rollup of intake, status, SLA and ownership",
    columns: [
      { key: "week", label: "Week commencing" },
      { key: "raised", label: "Raised", numeric: true },
      { key: "resolved", label: "Resolved", numeric: true },
      { key: "net", label: "Net", numeric: true },
      { key: "openEnd", label: "Open at close", numeric: true },
      { key: "critical", label: "Critical", numeric: true },
      { key: "breached", label: "Breached", numeric: true },
      { key: "slaPct", label: "SLA %", numeric: true },
      { key: "avgHours", label: "Avg hrs", numeric: true },
      { key: "topCategory", label: "Dominant category" },
      { key: "topStudio", label: "Busiest studio" },
      { key: "busiestOwner", label: "Busiest owner" },
    ],
    build: ({ tickets, from, to }) => {
      const weeks: ReportRow[] = [];
      const start = new Date(from);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
      start.setHours(0, 0, 0, 0);

      for (let cursor = new Date(start); cursor <= to && weeks.length < 60; cursor.setDate(cursor.getDate() + 7)) {
        const wStart = new Date(cursor);
        const wEnd = new Date(cursor);
        wEnd.setDate(wEnd.getDate() + 7);

        const raised = tickets.filter((t) => {
          const at = new Date(t.createdAt).getTime();
          return at >= wStart.getTime() && at < wEnd.getTime();
        });
        const resolved = tickets.filter((t) => {
          if (!t.resolvedAt) return false;
          const at = new Date(t.resolvedAt).getTime();
          return at >= wStart.getTime() && at < wEnd.getTime();
        });
        if (raised.length === 0 && resolved.length === 0) continue;

        const openEnd = tickets.filter((t) => {
          const created = new Date(t.createdAt).getTime();
          if (created >= wEnd.getTime()) return false;
          if (!t.resolvedAt) return true;
          return new Date(t.resolvedAt).getTime() >= wEnd.getTime();
        }).length;

        const closedInWeek = resolved.filter((t) => t.resolvedAt);
        const avg = closedInWeek.length
          ? r1(closedInWeek.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closedInWeek.length)
          : 0;
        const missed = closedInWeek.filter(breached).length;

        const topOf = (key: (t: Ticket) => string) => {
          const m = new Map<string, number>();
          for (const t of raised) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
          const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
          return best ? `${best[0]} (${best[1]})` : "—";
        };

        weeks.push({
          week: dayKey(wStart),
          raised: raised.length,
          resolved: resolved.length,
          net: raised.length - resolved.length,
          openEnd,
          critical: raised.filter((t) => t.priority === "Critical").length,
          breached: missed,
          slaPct: pct(closedInWeek.length - missed, closedInWeek.length || 1),
          avgHours: avg,
          topCategory: topOf((t) => t.category),
          topStudio: topOf((t) => t.studioName.split(",")[0]),
          busiestOwner: topOf((t) => t.assigneeName ?? "Unassigned"),
        });
      }
      return weeks.reverse();
    },
  },
  {
    id: "weekly-status-board",
    name: "Weekly status board",
    group: "Executive",
    blurb: "This week's tickets grouped by status with owner and age",
    columns: [
      { key: "status", label: "Status" },
      { key: "ticket", label: "Ticket" },
      { key: "title", label: "Title", width: "30%" },
      { key: "category", label: "Category" },
      { key: "studio", label: "Studio" },
      { key: "owner", label: "Owner" },
      { key: "priority", label: "Priority" },
      { key: "ageHours", label: "Age (hrs)", numeric: true },
      { key: "slaState", label: "SLA" },
    ],
    build: ({ tickets }) => {
      const since = Date.now() - 7 * 86400000;
      const order = ["Open", "In Progress", "Awaiting Info", "Resolved", "Closed"];
      return tickets
        .filter((t) => new Date(t.createdAt).getTime() >= since || (isOpen(t) && !!t.slaDueAt))
        .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || ageHours(b) - ageHours(a))
        .slice(0, 300)
        .map((t) => ({
          status: t.status,
          ticket: t.ticketNumber,
          title: t.title,
          category: t.subcategory,
          studio: t.studioName.split(",")[0],
          owner: t.assigneeName ?? "Unassigned",
          priority: t.priority,
          ageHours: ageHours(t),
          slaState: breached(t) ? "Breached" : isClosed(t) ? "Met" : "In window",
        }));
    },
  },
  {
    id: "weekly-department-digest",
    name: "Weekly department digest",
    group: "Executive",
    blurb: "Per-team weekly scorecard for the leadership stand-up",
    columns: [
      { key: "department", label: "Department" },
      { key: "raised", label: "Raised this week", numeric: true },
      { key: "resolved", label: "Resolved this week", numeric: true },
      { key: "carryOver", label: "Carried over", numeric: true },
      { key: "critical", label: "Critical open", numeric: true },
      { key: "breached", label: "Breached", numeric: true },
      { key: "avgHours", label: "Avg resolve hrs", numeric: true },
      { key: "headline", label: "Headline issue", width: "24%" },
    ],
    build: ({ tickets }) => {
      const since = Date.now() - 7 * 86400000;
      return [...groupBy(tickets, (t) => t.department).entries()]
        .map(([department, rows]) => {
          const raised = rows.filter((t) => new Date(t.createdAt).getTime() >= since);
          const resolved = rows.filter((t) => t.resolvedAt && new Date(t.resolvedAt).getTime() >= since);
          const closed = resolved.filter((t) => t.resolvedAt);
          const sub = new Map<string, number>();
          for (const t of raised) sub.set(t.subcategory, (sub.get(t.subcategory) ?? 0) + 1);
          const top = [...sub.entries()].sort((a, b) => b[1] - a[1])[0];
          return {
            department,
            raised: raised.length,
            resolved: resolved.length,
            carryOver: rows.filter((t) => isOpen(t) && new Date(t.createdAt).getTime() < since).length,
            critical: rows.filter((t) => isOpen(t) && t.priority === "Critical").length,
            breached: rows.filter(breached).length,
            avgHours: closed.length ? r1(closed.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closed.length) : 0,
            headline: top ? `${top[0]} (${top[1]})` : "—",
          };
        })
        .sort((a, b) => b.raised - a.raised);
    },
  },
  {
    id: "category-performance",
    name: "Category performance",
    group: "Operations",
    blurb: "Volume, SLA and resolution speed by ticket category",
    columns: AGG_COLS("category", "Category"),
    build: ({ tickets }) => aggRows(groupBy(tickets, (t) => t.category), "category"),
  },
  {
    id: "subcategory-detail",
    name: "Subcategory deep dive",
    group: "Operations",
    blurb: "Full breakdown across all 250+ issue types",
    columns: [{ key: "category", label: "Category" }, ...AGG_COLS("subcategory", "Subcategory").slice(1)],
    build: ({ tickets }) => {
      const map = groupBy(tickets, (t) => `${t.category}||${t.subcategory}`);
      return aggRows(map, "subcategory").map((row) => {
        const [category, subcategory] = String(row.subcategory).split("||");
        return { ...row, category, subcategory };
      });
    },
  },
  {
    id: "studio-scorecard",
    name: "Studio scorecard",
    group: "Operations",
    blurb: "Head-to-head comparison of every studio",
    columns: AGG_COLS("studio", "Studio"),
    build: ({ tickets }) => aggRows(groupBy(tickets, (t) => t.studioName), "studio"),
  },
  {
    id: "department-load",
    name: "Department workload",
    group: "Operations",
    blurb: "Routing queue volume, backlog and throughput",
    columns: AGG_COLS("department", "Department"),
    build: ({ tickets }) => aggRows(groupBy(tickets, (t) => t.department), "department"),
  },
  {
    id: "assignee-performance",
    name: "Owner performance",
    group: "SLA & Performance",
    blurb: "Per-assignee throughput, SLA hit rate and cycle time",
    columns: [
      { key: "assignee", label: "Owner" },
      { key: "team", label: "Department" },
      { key: "total", label: "Assigned", numeric: true },
      { key: "open", label: "Open", numeric: true },
      { key: "resolved", label: "Resolved", numeric: true },
      { key: "breached", label: "Breached", numeric: true },
      { key: "slaPct", label: "SLA %", numeric: true },
      { key: "avgHours", label: "Avg hrs", numeric: true },
    ],
    build: ({ tickets }) => {
      const map = groupBy(tickets, (t) => t.assigneeName ?? "Unassigned");
      return [...map.entries()]
        .map(([assignee, rows]) => {
          const closed = rows.filter((t) => t.resolvedAt);
          return {
            assignee,
            team: rows[0]?.assigneeTeam ?? "—",
            total: rows.length,
            open: rows.filter(isOpen).length,
            resolved: rows.filter(isClosed).length,
            breached: rows.filter(breached).length,
            slaPct: pct(closed.length - closed.filter(breached).length, closed.length || 1),
            avgHours: closed.length ? r1(closed.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closed.length) : 0,
          };
        })
        .sort((a, b) => b.total - a.total);
    },
  },
  {
    id: "sla-breaches",
    name: "SLA breach register",
    group: "SLA & Performance",
    blurb: "Every ticket that missed or is missing its resolution target",
    columns: [
      { key: "ticket", label: "Ticket" },
      { key: "title", label: "Title", width: "34%" },
      { key: "severity", label: "Severity" },
      { key: "priority", label: "Priority" },
      { key: "studio", label: "Studio" },
      { key: "owner", label: "Owner" },
      { key: "targetHours", label: "Target hrs", numeric: true },
      { key: "overdueHours", label: "Overdue hrs", numeric: true },
    ],
    build: ({ tickets }) =>
      tickets
        .filter(breached)
        .map((t) => {
          const due = t.slaDueAt ? new Date(t.slaDueAt) : null;
          const end = t.resolvedAt ? new Date(t.resolvedAt) : new Date();
          return {
            ticket: t.ticketNumber,
            title: t.title,
            severity: t.severity,
            priority: t.priority,
            studio: t.studioName.split(",")[0],
            owner: t.assigneeName ?? "Unassigned",
            targetHours: t.slaHours,
            overdueHours: due ? r1(hrs(due, end)) : 0,
          };
        })
        .sort((a, b) => b.overdueHours - a.overdueHours),
  },
  {
    id: "sla-policy",
    name: "SLA policy compliance",
    group: "SLA & Performance",
    blurb: "How each configured SLA band is actually performing",
    columns: [
      { key: "severity", label: "Severity" },
      { key: "total", label: "Tickets", numeric: true },
      { key: "avgTarget", label: "Avg target hrs", numeric: true },
      { key: "avgActual", label: "Avg actual hrs", numeric: true },
      { key: "met", label: "Met", numeric: true },
      { key: "missed", label: "Missed", numeric: true },
      { key: "slaPct", label: "Compliance %", numeric: true },
    ],
    build: ({ tickets }) => {
      const map = groupBy(tickets, (t) => t.severity);
      return [...map.entries()].map(([severity, rows]) => {
        const closed = rows.filter((t) => t.resolvedAt);
        const missed = closed.filter(breached).length;
        return {
          severity,
          total: rows.length,
          avgTarget: r1(rows.reduce((s, t) => s + t.slaHours, 0) / rows.length),
          avgActual: closed.length ? r1(closed.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closed.length) : 0,
          met: closed.length - missed,
          missed,
          slaPct: pct(closed.length - missed, closed.length || 1),
        };
      });
    },
  },
  {
    id: "aging",
    name: "Backlog aging",
    group: "SLA & Performance",
    blurb: "How long open tickets have been sitting, bucketed",
    columns: [
      { key: "bucket", label: "Age bucket" },
      { key: "count", label: "Open tickets", numeric: true },
      { key: "critical", label: "Critical", numeric: true },
      { key: "breached", label: "Breached", numeric: true },
      { key: "oldest", label: "Oldest (hrs)", numeric: true },
    ],
    build: ({ tickets }) => {
      const open = tickets.filter(isOpen);
      const buckets: { bucket: string; test: (h: number) => boolean }[] = [
        { bucket: "0-4 hours", test: (h) => h < 4 },
        { bucket: "4-24 hours", test: (h) => h >= 4 && h < 24 },
        { bucket: "1-3 days", test: (h) => h >= 24 && h < 72 },
        { bucket: "3-7 days", test: (h) => h >= 72 && h < 168 },
        { bucket: "Over 7 days", test: (h) => h >= 168 },
      ];
      return buckets.map((b) => {
        const rows = open.filter((t) => b.test(ageHours(t)));
        return {
          bucket: b.bucket,
          count: rows.length,
          critical: rows.filter((t) => t.priority === "Critical").length,
          breached: rows.filter(breached).length,
          oldest: rows.length ? Math.max(...rows.map(ageHours)) : 0,
        };
      });
    },
  },
  {
    id: "daily-trend",
    name: "Daily volume trend",
    group: "Operations",
    blurb: "Raised vs resolved vs net backlog, day by day",
    columns: [
      { key: "day", label: "Date" },
      { key: "raised", label: "Raised", numeric: true },
      { key: "resolved", label: "Resolved", numeric: true },
      { key: "net", label: "Net change", numeric: true },
      { key: "critical", label: "Critical", numeric: true },
      { key: "avgUrgency", label: "Avg urgency", numeric: true },
    ],
    build: ({ tickets, from, to }) => {
      const days: ReportRow[] = [];
      const cursor = new Date(from);
      while (cursor <= to && days.length < 120) {
        const key = dayKey(cursor);
        const raised = tickets.filter((t) => dayKey(t.createdAt) === key);
        const resolved = tickets.filter((t) => t.resolvedAt && dayKey(t.resolvedAt) === key);
        days.push({
          day: key,
          raised: raised.length,
          resolved: resolved.length,
          net: raised.length - resolved.length,
          critical: raised.filter((t) => t.priority === "Critical").length,
          avgUrgency: raised.length ? Math.round(raised.reduce((s, t) => s + t.urgencyScore, 0) / raised.length) : 0,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      return days;
    },
  },
  {
    id: "hour-heatmap",
    name: "Reporting hour pattern",
    group: "Operations",
    blurb: "What time of day issues surface — staffing signal",
    columns: [
      { key: "hour", label: "Hour (IST)" },
      { key: "count", label: "Tickets", numeric: true },
      { key: "critical", label: "Critical", numeric: true },
      { key: "share", label: "Share %", numeric: true },
    ],
    build: ({ tickets }) => {
      const total = tickets.length || 1;
      return Array.from({ length: 24 }, (_, h) => {
        const rows = tickets.filter(
          (t) => new Date(t.createdAt).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) === String(h).padStart(2, "0"),
        );
        return {
          hour: `${String(h).padStart(2, "0")}:00`,
          count: rows.length,
          critical: rows.filter((t) => t.priority === "Critical").length,
          share: pct(rows.length, total),
        };
      }).filter((r) => r.count > 0);
    },
  },
  {
    id: "weekday",
    name: "Weekday distribution",
    group: "Operations",
    blurb: "Which days generate the most friction",
    columns: [
      { key: "day", label: "Weekday" },
      { key: "count", label: "Tickets", numeric: true },
      { key: "critical", label: "Critical", numeric: true },
      { key: "avgHours", label: "Avg resolve hrs", numeric: true },
    ],
    build: ({ tickets }) => {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return names.map((day, i) => {
        const rows = tickets.filter((t) => new Date(t.createdAt).getDay() === i);
        const closed = rows.filter((t) => t.resolvedAt);
        return {
          day,
          count: rows.length,
          critical: rows.filter((t) => t.priority === "Critical").length,
          avgHours: closed.length ? r1(closed.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closed.length) : 0,
        };
      });
    },
  },
  {
    id: "sentiment",
    name: "Sentiment & emotion",
    group: "Member Experience",
    blurb: "AI tone analysis across every intake",
    columns: [
      { key: "sentiment", label: "Sentiment" },
      { key: "emotion", label: "Dominant emotion" },
      { key: "count", label: "Tickets", numeric: true },
      { key: "share", label: "Share %", numeric: true },
      { key: "avgUrgency", label: "Avg urgency", numeric: true },
      { key: "highChurn", label: "High churn", numeric: true },
    ],
    build: ({ tickets }) => {
      const total = tickets.length || 1;
      return [...groupBy(tickets, (t) => t.sentiment).entries()].map(([sentiment, rows]) => {
        const emo = [...groupBy(rows, (t) => t.emotion).entries()].sort((a, b) => b[1].length - a[1].length)[0];
        return {
          sentiment,
          emotion: emo ? `${emo[0]} (${emo[1].length})` : "—",
          count: rows.length,
          share: pct(rows.length, total),
          avgUrgency: Math.round(rows.reduce((s, t) => s + t.urgencyScore, 0) / rows.length),
          highChurn: rows.filter((t) => t.churnRisk === "High").length,
        };
      });
    },
  },
  {
    id: "churn-risk",
    name: "Churn risk register",
    group: "Financial & Risk",
    blurb: "Members whose tickets signal they may leave",
    columns: [
      { key: "member", label: "Member" },
      { key: "tickets", label: "Tickets", numeric: true },
      { key: "highRisk", label: "High risk", numeric: true },
      { key: "lastIssue", label: "Latest issue", width: "28%" },
      { key: "studio", label: "Studio" },
      { key: "openNow", label: "Open now", numeric: true },
    ],
    build: ({ tickets }) => {
      const named = tickets.filter((t) => t.memberName && t.memberName !== "Anonymous member");
      return [...groupBy(named, (t) => t.memberName!).entries()]
        .map(([member, rows]) => {
          const sorted = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          return {
            member,
            tickets: rows.length,
            highRisk: rows.filter((t) => t.churnRisk === "High").length,
            lastIssue: sorted[0].subcategory,
            studio: sorted[0].studioName.split(",")[0],
            openNow: rows.filter(isOpen).length,
          };
        })
        .filter((r) => r.highRisk > 0 || r.tickets > 1)
        .sort((a, b) => b.highRisk - a.highRisk || b.tickets - a.tickets);
    },
  },
  {
    id: "repeat-issues",
    name: "Repeat issue detector",
    group: "Operations",
    blurb: "Same subcategory recurring at the same studio — root-cause candidates",
    columns: [
      { key: "issue", label: "Issue" },
      { key: "studio", label: "Studio" },
      { key: "occurrences", label: "Occurrences", numeric: true },
      { key: "firstSeen", label: "First seen" },
      { key: "lastSeen", label: "Last seen" },
      { key: "stillOpen", label: "Still open", numeric: true },
    ],
    build: ({ tickets }) =>
      [...groupBy(tickets, (t) => `${t.subcategory}||${t.studioName}`).entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([key, rows]) => {
          const [issue, studio] = key.split("||");
          const sorted = [...rows].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          return {
            issue,
            studio: studio.split(",")[0],
            occurrences: rows.length,
            firstSeen: dayKey(sorted[0].createdAt),
            lastSeen: dayKey(sorted.at(-1)!.createdAt),
            stillOpen: rows.filter(isOpen).length,
          };
        })
        .sort((a, b) => b.occurrences - a.occurrences),
  },
  {
    id: "trainer-mentions",
    name: "Trainer mention analysis",
    group: "Trainers & Classes",
    blurb: "Which trainers appear in feedback, and how it reads",
    columns: [
      { key: "trainer", label: "Trainer" },
      { key: "mentions", label: "Mentions", numeric: true },
      { key: "positive", label: "Positive", numeric: true },
      { key: "negative", label: "Negative", numeric: true },
      { key: "escalated", label: "Escalated", numeric: true },
      { key: "topIssue", label: "Top theme" },
      { key: "netScore", label: "Net score", numeric: true },
    ],
    build: ({ tickets }) => {
      const withTrainer = tickets.filter((t) => t.trainerName && t.trainerName !== "Not identified");
      return [...groupBy(withTrainer, (t) => t.trainerName!).entries()]
        .map(([trainer, rows]) => {
          const positive = rows.filter((t) => t.sentiment === "Positive").length;
          const negative = rows.filter((t) => t.sentiment === "Negative").length;
          const escalated = rows.filter((t) => t.sentiment === "Escalated").length;
          const top = [...groupBy(rows, (t) => t.subcategory).entries()].sort((a, b) => b[1].length - a[1].length)[0];
          return {
            trainer,
            mentions: rows.length,
            positive,
            negative,
            escalated,
            topIssue: top?.[0] ?? "—",
            netScore: pct(positive, rows.length) - pct(negative + escalated, rows.length),
          };
        })
        .sort((a, b) => b.mentions - a.mentions);
    },
  },
  {
    id: "trainer-evaluations",
    name: "Trainer evaluation scores",
    group: "Trainers & Classes",
    blurb: "Weighted rubric results from Fillout training assessments",
    columns: [
      { key: "trainer", label: "Trainer" },
      { key: "evaluations", label: "Evaluations", numeric: true },
      { key: "avgScore", label: "Avg score %", numeric: true },
      { key: "latestScore", label: "Latest %", numeric: true },
      { key: "trend", label: "Trend" },
      { key: "band", label: "Band" },
      { key: "template", label: "Format" },
    ],
    build: ({ evaluations }) =>
      [...groupBy(evaluations, (e) => e.trainerName).entries()]
        .map(([trainer, rows]) => {
          const sorted = [...rows].sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
          const avg = Math.round(rows.reduce((s, e) => s + e.scorePercent, 0) / rows.length);
          const latest = sorted.at(-1)!;
          const prev = sorted.length > 1 ? sorted.at(-2)! : null;
          const delta = prev ? latest.scorePercent - prev.scorePercent : 0;
          return {
            trainer,
            evaluations: rows.length,
            avgScore: avg,
            latestScore: latest.scorePercent,
            trend: prev ? `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} pts` : "First review",
            band: latest.band,
            template: latest.template,
          };
        })
        .sort((a, b) => b.avgScore - a.avgScore),
  },
  {
    id: "rubric-gaps",
    name: "Coaching gap analysis",
    group: "Trainers & Classes",
    blurb: "Weakest rubric criteria across the whole training team",
    columns: [
      { key: "criterion", label: "Criterion" },
      { key: "assessments", label: "Assessments", numeric: true },
      { key: "avgPct", label: "Avg attainment %", numeric: true },
      { key: "below70", label: "Below 70%", numeric: true },
      { key: "worstTrainer", label: "Lowest scorer" },
    ],
    build: ({ evaluations }) => {
      const bucket = new Map<string, { total: number; earned: number; weight: number; low: number; worst: { name: string; pct: number } | null }>();
      for (const evaluation of evaluations) {
        for (const s of evaluation.scores ?? []) {
          const entry = bucket.get(s.category) ?? { total: 0, earned: 0, weight: 0, low: 0, worst: null };
          const ratio = s.weightage > 0 ? s.score / s.weightage : 0;
          entry.total += 1;
          entry.earned += s.score;
          entry.weight += s.weightage;
          if (ratio < 0.7) entry.low += 1;
          if (!entry.worst || ratio * 100 < entry.worst.pct) {
            entry.worst = { name: evaluation.trainerName, pct: Math.round(ratio * 100) };
          }
          bucket.set(s.category, entry);
        }
      }
      return [...bucket.entries()]
        .map(([criterion, v]) => ({
          criterion,
          assessments: v.total,
          avgPct: pct(v.earned, v.weight || 1),
          below70: v.low,
          worstTrainer: v.worst ? `${v.worst.name} (${v.worst.pct}%)` : "—",
        }))
        .sort((a, b) => a.avgPct - b.avgPct);
    },
  },
  {
    id: "hosted-classes",
    name: "Hosted class outcomes",
    group: "Trainers & Classes",
    blurb: "Community/private class feedback, audience fit and purchase intent",
    columns: [
      { key: "session", label: "Session", width: "26%" },
      { key: "host", label: "Host" },
      { key: "trainer", label: "Trainer" },
      { key: "attendees", label: "Attendees", numeric: true },
      { key: "hostScore", label: "Host /5", numeric: true },
      { key: "classScore", label: "Class /5", numeric: true },
      { key: "relevance", label: "Audience fit" },
      { key: "intent", label: "Purchase intent" },
      { key: "conversions", label: "Hot leads", numeric: true },
    ],
    build: ({ classFeedback }) =>
      classFeedback.map((f) => ({
        session: f.sessionName,
        host: f.hostName || "—",
        trainer: f.trainerName || "—",
        attendees: f.attendeeCount,
        hostScore: f.hostScore,
        classScore: f.classScore,
        relevance: f.audienceRelevance || "—",
        intent: f.purchaseIntent || "—",
        conversions: f.conversionCount,
      })),
  },
  {
    id: "class-issues",
    name: "Class & session issues",
    group: "Trainers & Classes",
    blurb: "Which formats and time slots attract complaints",
    columns: [
      { key: "classInfo", label: "Class / format" },
      { key: "count", label: "Tickets", numeric: true },
      { key: "negative", label: "Negative", numeric: true },
      { key: "topIssue", label: "Top issue" },
      { key: "studios", label: "Studios", numeric: true },
    ],
    build: ({ tickets }) =>
      [...groupBy(tickets.filter((t) => t.classInfo), (t) => t.classInfo!).entries()]
        .map(([classInfo, rows]) => {
          const top = [...groupBy(rows, (t) => t.subcategory).entries()].sort((a, b) => b[1].length - a[1].length)[0];
          return {
            classInfo,
            count: rows.length,
            negative: rows.filter((t) => t.sentiment === "Negative" || t.sentiment === "Escalated").length,
            topIssue: top?.[0] ?? "—",
            studios: new Set(rows.map((t) => t.studioName)).size,
          };
        })
        .sort((a, b) => b.count - a.count),
  },
  {
    id: "membership-impact",
    name: "Membership impact",
    group: "Financial & Risk",
    blurb: "Which packages generate the most service load",
    columns: [
      { key: "membership", label: "Membership / package" },
      { key: "count", label: "Tickets", numeric: true },
      { key: "billing", label: "Billing issues", numeric: true },
      { key: "highChurn", label: "High churn", numeric: true },
      { key: "avgUrgency", label: "Avg urgency", numeric: true },
    ],
    build: ({ tickets }) =>
      [...groupBy(tickets.filter((t) => t.membershipRef), (t) => t.membershipRef!).entries()]
        .map(([membership, rows]) => ({
          membership,
          count: rows.length,
          billing: rows.filter((t) => t.category === "Pricing and Memberships").length,
          highChurn: rows.filter((t) => t.churnRisk === "High").length,
          avgUrgency: Math.round(rows.reduce((s, t) => s + t.urgencyScore, 0) / rows.length),
        }))
        .sort((a, b) => b.count - a.count),
  },
  {
    id: "safety-register",
    name: "Safety & incident register",
    group: "Financial & Risk",
    blurb: "Full audit trail of every safety, security and theft report",
    columns: [
      { key: "ticket", label: "Ticket" },
      { key: "date", label: "Date" },
      { key: "type", label: "Incident type" },
      { key: "studio", label: "Studio" },
      { key: "severity", label: "Severity" },
      { key: "status", label: "Status" },
      { key: "owner", label: "Owner" },
      { key: "resolvedIn", label: "Resolved in (hrs)", numeric: true },
    ],
    build: ({ tickets }) =>
      tickets
        .filter((t) => t.category === "Safety and Security" || t.category === "Theft and Lost Items")
        .map((t) => ({
          ticket: t.ticketNumber,
          date: dayKey(t.createdAt),
          type: t.subcategory,
          studio: t.studioName.split(",")[0],
          severity: t.severity,
          status: t.status,
          owner: t.assigneeName ?? "Unassigned",
          resolvedIn: t.resolvedAt ? r1(hrs(t.createdAt, t.resolvedAt)) : 0,
        }))
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
  },
  {
    id: "effort-matrix",
    name: "Effort vs impact matrix",
    group: "Executive",
    blurb: "Where to spend fix capacity for maximum member benefit",
    columns: [
      { key: "quadrant", label: "Quadrant" },
      { key: "count", label: "Tickets", numeric: true },
      { key: "examples", label: "Representative issues", width: "40%" },
      { key: "recommendation", label: "Recommendation", width: "26%" },
    ],
    build: ({ tickets }) => {
      const quads = [
        { quadrant: "Quick wins (low effort, high urgency)", test: (t: Ticket) => t.effort === "Low" && t.urgencyScore >= 60, recommendation: "Clear these first — same-day capacity" },
        { quadrant: "Major projects (high effort, high urgency)", test: (t: Ticket) => t.effort === "High" && t.urgencyScore >= 60, recommendation: "Plan, resource and budget properly" },
        { quadrant: "Fill-ins (low effort, low urgency)", test: (t: Ticket) => t.effort === "Low" && t.urgencyScore < 60, recommendation: "Batch into weekly housekeeping" },
        { quadrant: "Reconsider (high effort, low urgency)", test: (t: Ticket) => t.effort === "High" && t.urgencyScore < 60, recommendation: "Challenge the business case" },
        { quadrant: "Standard (medium effort)", test: (t: Ticket) => t.effort === "Medium", recommendation: "Run through the normal queue" },
      ];
      return quads.map((q) => {
        const rows = tickets.filter(q.test);
        return {
          quadrant: q.quadrant,
          count: rows.length,
          examples: [...new Set(rows.map((t) => t.subcategory))].slice(0, 3).join(", ") || "—",
          recommendation: q.recommendation,
        };
      });
    },
  },
  {
    id: "source-channel",
    name: "Intake channel analysis",
    group: "Executive",
    blurb: "AI assistant vs templates vs manual — quality comparison",
    columns: [
      { key: "source", label: "Channel" },
      { key: "count", label: "Tickets", numeric: true },
      { key: "avgConfidence", label: "Avg AI confidence", numeric: true },
      { key: "reclassified", label: "Escalated tone", numeric: true },
      { key: "avgHours", label: "Avg resolve hrs", numeric: true },
      { key: "slaPct", label: "SLA %", numeric: true },
    ],
    build: ({ tickets }) =>
      [...groupBy(tickets, (t) => t.source).entries()]
        .map(([source, rows]) => {
          const closed = rows.filter((t) => t.resolvedAt);
          return {
            source,
            count: rows.length,
            avgConfidence: Math.round(rows.reduce((s, t) => s + t.aiConfidence, 0) / rows.length),
            reclassified: rows.filter((t) => t.sentiment === "Escalated").length,
            avgHours: closed.length ? r1(closed.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closed.length) : 0,
            slaPct: pct(closed.length - closed.filter(breached).length, closed.length || 1),
          };
        })
        .sort((a, b) => b.count - a.count),
  },
  {
    id: "reporter-activity",
    name: "Team reporting activity",
    group: "Executive",
    blurb: "Who is surfacing issues — engagement signal per studio",
    columns: [
      { key: "reporter", label: "Reported by" },
      { key: "role", label: "Role" },
      { key: "count", label: "Tickets raised", numeric: true },
      { key: "critical", label: "Critical", numeric: true },
      { key: "categories", label: "Distinct areas", numeric: true },
      { key: "lastRaised", label: "Last raised" },
    ],
    build: ({ tickets }) =>
      [...groupBy(tickets, (t) => t.reportedBy).entries()]
        .map(([reporter, rows]) => {
          const sorted = [...rows].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          return {
            reporter,
            role: sorted[0].reportedByRole || "—",
            count: rows.length,
            critical: rows.filter((t) => t.priority === "Critical").length,
            categories: new Set(rows.map((t) => t.category)).size,
            lastRaised: dayKey(sorted[0].createdAt),
          };
        })
        .sort((a, b) => b.count - a.count),
  },
  {
    id: "resolution-quality",
    name: "Resolution quality audit",
    group: "SLA & Performance",
    blurb: "Closed tickets missing resolution notes or closed suspiciously fast",
    columns: [
      { key: "ticket", label: "Ticket" },
      { key: "title", label: "Title", width: "34%" },
      { key: "owner", label: "Owner" },
      { key: "resolveHours", label: "Resolved in (hrs)", numeric: true },
      { key: "hasNotes", label: "Notes recorded" },
      { key: "flag", label: "Audit flag" },
    ],
    build: ({ tickets }) =>
      tickets
        .filter(isClosed)
        .map((t) => {
          const h = t.resolvedAt ? r1(hrs(t.createdAt, t.resolvedAt)) : 0;
          const notes = !!t.resolutionNotes?.trim();
          const flags: string[] = [];
          if (!notes) flags.push("No resolution notes");
          if (h < 0.25) flags.push("Closed under 15 min");
          if (t.priority === "Critical" && !notes) flags.push("Critical without record");
          return {
            ticket: t.ticketNumber,
            title: t.title,
            owner: t.assigneeName ?? "Unassigned",
            resolveHours: h,
            hasNotes: notes ? "Yes" : "No",
            flag: flags.join(" · ") || "Clean",
          };
        })
        .filter((r) => r.flag !== "Clean")
        .sort((a, b) => a.resolveHours - b.resolveHours),
  },
  {
    id: "priority-mix",
    name: "Priority & severity mix",
    group: "Operations",
    blurb: "How AI severity maps onto priority and outcomes",
    columns: [
      { key: "priority", label: "Priority" },
      { key: "severity", label: "Severity" },
      { key: "count", label: "Tickets", numeric: true },
      { key: "open", label: "Open", numeric: true },
      { key: "avgHours", label: "Avg resolve hrs", numeric: true },
      { key: "slaHours", label: "Avg SLA hrs", numeric: true },
    ],
    build: ({ tickets }) =>
      [...groupBy(tickets, (t) => `${t.priority}||${t.severity}`).entries()]
        .map(([key, rows]) => {
          const [priority, severity] = key.split("||");
          const closed = rows.filter((t) => t.resolvedAt);
          return {
            priority,
            severity,
            count: rows.length,
            open: rows.filter(isOpen).length,
            avgHours: closed.length ? r1(closed.reduce((s, t) => s + hrs(t.createdAt, t.resolvedAt!), 0) / closed.length) : 0,
            slaHours: r1(rows.reduce((s, t) => s + t.slaHours, 0) / rows.length),
          };
        })
        .sort((a, b) => b.count - a.count),
  },
  {
    id: "momence-linked",
    name: "Momence data coverage",
    group: "Executive",
    blurb: "How often intake is backed by real Momence records",
    columns: [
      { key: "field", label: "Linked field" },
      { key: "linked", label: "Tickets linked", numeric: true },
      { key: "coverage", label: "Coverage %", numeric: true },
      { key: "note", label: "Why it matters", width: "36%" },
    ],
    build: ({ tickets }) => {
      const total = tickets.length || 1;
      const rows = [
        { field: "Momence member ID", linked: tickets.filter((t) => t.momenceMemberId).length, note: "Enables billing and visit history lookup" },
        { field: "Momence session ID", linked: tickets.filter((t) => t.momenceSessionId).length, note: "Exact class, teacher and roster context" },
        { field: "Membership / package", linked: tickets.filter((t) => t.membershipRef).length, note: "Revenue attribution and refund handling" },
        { field: "Trainer named", linked: tickets.filter((t) => t.trainerName && t.trainerName !== "Not identified").length, note: "Feeds trainer performance profiles" },
        { field: "Studio assigned", linked: tickets.filter((t) => t.studioId).length, note: "Routes to the local owner" },
      ];
      return rows.map((r) => ({ ...r, coverage: pct(r.linked, total) }));
    },
  },
  {
    id: "open-queue",
    name: "Live open queue",
    group: "Operations",
    blurb: "Exportable working list of everything still open",
    columns: [
      { key: "ticket", label: "Ticket" },
      { key: "title", label: "Title", width: "30%" },
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
      { key: "studio", label: "Studio" },
      { key: "owner", label: "Owner" },
      { key: "ageHours", label: "Age (hrs)", numeric: true },
      { key: "dueIn", label: "Due in (hrs)", numeric: true },
    ],
    build: ({ tickets }) =>
      tickets
        .filter(isOpen)
        .map((t) => ({
          ticket: t.ticketNumber,
          title: t.title,
          status: t.status,
          priority: t.priority,
          studio: t.studioName.split(",")[0],
          owner: t.assigneeName ?? "Unassigned",
          ageHours: ageHours(t),
          dueIn: t.slaDueAt ? r1(hrs(new Date(), t.slaDueAt)) : 0,
        }))
        .sort((a, b) => a.dueIn - b.dueIn),
  },
];

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

export function toCsv(columns: ReportColumn[], rows: ReportRow[]): string {
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    columns.map((c) => esc(c.label)).join(","),
    ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(",")),
  ].join("\n");
}
