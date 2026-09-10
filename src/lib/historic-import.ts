import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { staff, studios, ticketEvents, tickets } from "@/db/schema";
import { CATEGORY_DEPARTMENT } from "./org";
import { TAXONOMY, type Priority } from "./taxonomy";
import { computeSla } from "./sla";
import { classify } from "./ai";

/** Shape of the Athena historic export. */
type HistoricRow = {
  ticket_id?: string;
  date_opened?: string;
  last_response_date?: string;
  customer_name?: string;
  customer_email?: string;
  priority?: string;
  complaint_category?: string;
  complaint_subcategory?: string;
  current_status?: string;
  issue_summary?: string;
  root_cause?: string;
  response_strategy?: string;
  recommended_actions?: string[] | string;
  key_customer_statements?: string[] | string;
  internal_risk_flags?: string[] | string;
  sentiment?: { frustration_level?: string; emotional_tone?: string; risk_indicators?: string } | string;
  ownership?: string;
  sla_aging?: string;
  sla_classification?: string;
  email_type?: string;
  intelligence_bucket?: string;
  cx_ticket_confidence?: string;
  unknowns?: string;
};

/** Athena categories → our taxonomy. */
const CATEGORY_MAP: Record<string, string> = {
  "Internal Systems": "Operating Systems",
  "Facility / Hygiene": "Studio Amenities and Facilities",
  "Booking / Scheduling": "Scheduling",
  "Class Quality": "Class Experience",
  "Trainer Conduct": "Trainer Feedback",
  "Injury / Safety": "Safety and Security",
  "Communication Gap": "Customer Service and Communication",
  "Access / Check-in": "Operating Systems",
  Other: "Miscellaneous",
};

const STATUS_MAP: Record<string, string> = {
  resolved: "Resolved",
  unresolved: "Open",
  escalated: "In Progress",
  partially_resolved: "In Progress",
  awaiting_internal_action: "In Progress",
  awaiting_customer_response: "Awaiting Info",
};

const STUDIO_HINTS: { re: RegExp; code: string }[] = [
  { re: /kemps|kwality|colaba|south mumbai/i, code: "KC" },
  { re: /bandra|supreme|khar|juhu/i, code: "BAN" },
  { re: /bengaluru|bangalore|indiranagar|kenkere/i, code: "IND" },
];

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function toTitle(row: HistoricRow): string {
  const raw = (row.issue_summary ?? row.complaint_subcategory ?? "Historic ticket").replace(/\s+/g, " ").trim();
  const first = raw.split(/(?<=[.!?])\s/)[0] ?? raw;
  const cut = first.length > 92 ? `${first.slice(0, 92).split(" ").slice(0, -1).join(" ")}…` : first;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

/** Map an Athena subcategory onto the closest entry in our taxonomy. */
function resolveSubcategory(category: string, athenaSub: string, text: string): string {
  const list = TAXONOMY[category] ?? [];
  if (list.length === 0) return athenaSub || "Miscellaneous";

  const target = (athenaSub || "").toLowerCase();
  const exact = list.find((s) => s.toLowerCase() === target);
  if (exact) return exact;

  const words = target.split(/[^a-z]+/).filter((w) => w.length > 3);
  let best: { sub: string; hits: number } | null = null;
  for (const sub of list) {
    const label = sub.toLowerCase();
    const hits = words.filter((w) => label.includes(w)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { sub, hits };
  }
  if (best) return best.sub;

  const guess = classify(`${athenaSub} ${text}`, 30).find((g) => g.category === category);
  return guess?.subcategory ?? list[list.length - 1];
}

function sentimentOf(row: HistoricRow): { sentiment: string; emotion: string; churn: string } {
  const s = row.sentiment;
  const level = typeof s === "object" ? (s.frustration_level ?? "") : String(s ?? "");
  const tone = typeof s === "object" ? (s.emotional_tone ?? "") : "";
  const risk = typeof s === "object" ? (s.risk_indicators ?? "") : "";

  const l = level.toLowerCase();
  const sentiment =
    l.includes("critical") || l.includes("severe") ? "Escalated"
    : l.includes("high") ? "Escalated"
    : l.includes("medium") ? "Negative"
    : l.includes("low") ? "Neutral"
    : /positive|apprecia|delight/i.test(tone) ? "Positive"
    : "Neutral";

  const emotion =
    tone.split(/[,;]/)[0]?.trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 28) ||
    (sentiment === "Escalated" ? "Frustrated" : "Informational");

  const churn = /churn|cancel|leav|attrition|lapsed|retention|revenue loss/i.test(`${risk} ${tone}`)
    ? "High"
    : sentiment === "Escalated" || sentiment === "Negative"
      ? "Medium"
      : "Low";

  return { sentiment, emotion, churn };
}

export type ImportSummary = {
  total: number;
  imported: number;
  skipped: number;
  byCategory: Record<string, number>;
  earliest: string | null;
  latest: string | null;
};

export async function loadHistoricFile(): Promise<HistoricRow[]> {
  const file = path.join(process.cwd(), "data", "historic-tickets.json");
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as HistoricRow[] | { tickets?: HistoricRow[] };
  return Array.isArray(parsed) ? parsed : (parsed.tickets ?? []);
}

/** Bulk-import the Athena historic tickets. Idempotent on ticket number. */
export async function importHistoricTickets(
  rows?: HistoricRow[],
  opts: { limit?: number } = {},
): Promise<ImportSummary> {
  const data = (rows ?? (await loadHistoricFile())).slice(0, opts.limit ?? 5000);

  const [allStudios, allStaff, existing] = await Promise.all([
    db.select().from(studios),
    db.select().from(staff),
    db.select({ n: tickets.ticketNumber }).from(tickets),
  ]);
  const have = new Set(existing.map((e) => e.n));
  const byCode = new Map(allStudios.map((s) => [s.code, s]));

  const summary: ImportSummary = {
    total: data.length,
    imported: 0,
    skipped: 0,
    byCategory: {},
    earliest: null,
    latest: null,
  };

  const batch: (typeof tickets.$inferInsert)[] = [];
  const events: { number: string; message: string; actor: string; at: Date }[] = [];

  for (const row of data) {
    const number = row.ticket_id?.trim() || `HIST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    if (have.has(number)) {
      summary.skipped += 1;
      continue;
    }
    have.add(number);

    const category = CATEGORY_MAP[row.complaint_category ?? ""] ?? "Miscellaneous";
    const bodyText = [
      row.issue_summary,
      row.root_cause,
      ...asList(row.key_customer_statements),
      ...asList(row.internal_risk_flags),
    ]
      .filter(Boolean)
      .join(" ");
    const subcategory = resolveSubcategory(category, row.complaint_subcategory ?? "", bodyText);

    const createdAt = row.date_opened ? new Date(`${row.date_opened}T09:00:00Z`) : new Date();
    if (Number.isNaN(createdAt.getTime())) continue;
    const iso = createdAt.toISOString().slice(0, 10);
    if (!summary.earliest || iso < summary.earliest) summary.earliest = iso;
    if (!summary.latest || iso > summary.latest) summary.latest = iso;

    const status = STATUS_MAP[row.current_status ?? ""] ?? "Open";
    const closed = status === "Resolved" || status === "Closed";
    const resolvedAt =
      closed && row.last_response_date ? new Date(`${row.last_response_date}T17:00:00Z`) : null;

    const { sentiment, emotion, churn } = sentimentOf(row);
    const priority = (["Low", "Medium", "High", "Critical"].includes(row.priority ?? "")
      ? row.priority
      : "Medium") as Priority;

    const urgency =
      priority === "Critical" ? 92 : priority === "High" ? 74 : priority === "Medium" ? 52 : 28;

    const sla = computeSla({
      category,
      subcategory,
      urgencyScore: urgency,
      churnRisk: churn,
      sentiment,
      impact: undefined,
      atRisk: priority === "Critical",
    });

    // Studio from any location hint in the text.
    const hint = STUDIO_HINTS.find((h) => h.re.test(`${bodyText} ${row.ownership ?? ""}`));
    const studio = hint ? byCode.get(hint.code) : undefined;

    // Owner from the ownership string.
    const ownerName = (row.ownership ?? "").split(/[/(]/)[0].trim();
    const owner =
      allStaff.find((s) => ownerName && s.name.toLowerCase().includes(ownerName.toLowerCase().split(" ")[0])) ??
      allStaff.find((s) => s.department === (CATEGORY_DEPARTMENT[category] ?? "Operations"));

    const actions = asList(row.recommended_actions);
    const statements = asList(row.key_customer_statements);
    const risks = asList(row.internal_risk_flags);

    const description = [
      row.issue_summary ?? "",
      statements.length ? `\nKey statements:\n${statements.map((s) => `• ${s}`).join("\n")}` : "",
      risks.length ? `\nInternal risk flags:\n${risks.map((s) => `• ${s}`).join("\n")}` : "",
      row.unknowns ? `\nOpen questions: ${row.unknowns}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

    const details: Record<string, string> = {};
    if (row.sla_aging) details["SLA aging at import"] = row.sla_aging;
    if (row.sla_classification) details["SLA classification"] = row.sla_classification;
    if (row.email_type) details["Email type"] = row.email_type;
    if (row.intelligence_bucket) details["Intelligence bucket"] = row.intelligence_bucket;
    if (row.cx_ticket_confidence) details["Classification confidence"] = row.cx_ticket_confidence;
    if (row.ownership) details["Original ownership"] = row.ownership;
    if (row.response_strategy) details["Response strategy"] = row.response_strategy;

    batch.push({
      ticketNumber: number,
      title: toTitle(row),
      summary: (row.issue_summary ?? "").slice(0, 400),
      description,
      category,
      subcategory,
      priority,
      status,
      studioId: studio?.id ?? null,
      studioName: studio ? `${studio.name}, ${studio.city}` : "Not studio specific",
      source: "Historic import",
      reportedBy: row.customer_name?.slice(0, 90) || "Historic record",
      reportedByRole: row.email_type ?? "",
      raisedFor: row.customer_email?.includes("physique57") ? "Staff or trainer concern" : "On behalf of a member",
      memberName: row.customer_name?.slice(0, 90) ?? null,
      memberContact: row.customer_email ?? null,
      sentiment,
      emotion,
      urgencyScore: urgency,
      churnRisk: churn,
      effort: actions.length > 3 ? "High" : actions.length > 1 ? "Medium" : "Low",
      rootCause: row.root_cause ?? "",
      suggestedAction: actions[0] ?? row.response_strategy ?? "",
      aiConfidence: row.cx_ticket_confidence === "High" ? 88 : row.cx_ticket_confidence === "Medium" ? 72 : 60,
      aiEngine: "Athena historic analysis",
      severity: sla.severity,
      slaHours: Math.round(sla.resolveHours),
      slaReason: sla.reason,
      department: CATEGORY_DEPARTMENT[category] ?? "Operations",
      tags: [
        "historic",
        ...(row.intelligence_bucket ? [row.intelligence_bucket.toLowerCase().replace(/\s+/g, "-")] : []),
      ],
      details,
      assigneeId: owner?.id ?? null,
      assigneeName: owner?.name ?? null,
      assigneeTeam: owner?.department ?? CATEGORY_DEPARTMENT[category] ?? "Operations",
      assigneeEmail: owner?.email ?? null,
      assignmentReason: row.ownership ? `Imported ownership: ${row.ownership}` : "Auto-routed on import",
      slaDueAt: new Date(createdAt.getTime() + sla.resolveHours * 3600 * 1000),
      resolutionNotes: closed ? (actions[0] ?? "") : null,
      resolvedAt,
      createdAt,
      updatedAt: resolvedAt ?? createdAt,
    });

    if (actions.length > 0) {
      events.push({
        number,
        actor: "Athena analysis",
        message: `Recommended actions:\n${actions.map((a) => `• ${a}`).join("\n")}`,
        at: new Date(createdAt.getTime() + 60_000),
      });
    }

    summary.imported += 1;
    summary.byCategory[category] = (summary.byCategory[category] ?? 0) + 1;
  }

  // Insert in chunks so a large import stays well within statement limits.
  for (let i = 0; i < batch.length; i += 80) {
    await db.insert(tickets).values(batch.slice(i, i + 80));
  }

  if (events.length > 0) {
    const rowsMap = await db
      .select({ id: tickets.id, n: tickets.ticketNumber })
      .from(tickets)
      .where(sql`${tickets.source} = 'Historic import'`);
    const idByNumber = new Map(rowsMap.map((r) => [r.n, r.id]));
    const eventRows = events
      .map((e) => ({
        ticketId: idByNumber.get(e.number) ?? 0,
        type: "ai",
        actor: e.actor,
        message: e.message,
        meta: {},
        createdAt: e.at,
      }))
      .filter((e) => e.ticketId > 0);
    for (let i = 0; i < eventRows.length; i += 100) {
      await db.insert(ticketEvents).values(eventRows.slice(i, i + 100));
    }
  }

  // Backfill semantic embeddings so historic tickets are searchable by meaning
  // from day one — best-effort; the lexical fallback covers any shortfall.
  try {
    const { backfillTicketEmbeddings } = await import("./recurrence");
    for (let done = 0; done < summary.imported; done += 120) {
      const n = await backfillTicketEmbeddings(120);
      if (n === 0) break;
    }
  } catch {
    // Embeddings are an upgrade, never a requirement.
  }

  return summary;
}

export async function historicStatus() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(eq(tickets.source, "Historic import"));
  let available = 0;
  try {
    available = (await loadHistoricFile()).length;
  } catch {
    available = 0;
  }
  return { imported: row?.count ?? 0, available };
}
