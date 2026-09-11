import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { tickets } from "@/db/schema";
import { tokenize } from "./ai";
import { embed, cosine } from "./embeddings";

export type RelatedTicket = {
  id: number;
  ticketNumber: string;
  title: string;
  category: string;
  subcategory: string;
  status: string;
  createdAt: string;
  overlap: number;
};

const WINDOW_DAYS = 60;
const MIN_CANDIDATES = 150;

/**
 * Recent tickets that look like the same underlying problem.
 *
 * Scoped to the studio when known, then ranked by semantic similarity: the
 * report (and each candidate) is embedded and compared by cosine distance, so
 * "aircon fault" matches "AC not cooling". Falls back to token overlap when no
 * embedding model is available — context recall must never hard-fail.
 */
export async function findRelatedTickets(input: {
  text: string;
  studioId?: number | null;
  category?: string;
  limit?: number;
}): Promise<RelatedTicket[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);
  const filters = [gte(tickets.createdAt, since)];
  if (typeof input.studioId === "number") filters.push(eq(tickets.studioId, input.studioId));

  let rows;
  try {
    // Loaded lazily so this module can be imported without a database.
    const { db } = await import("@/db");
    rows = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        title: tickets.title,
        summary: tickets.summary,
        rootCause: tickets.rootCause,
        category: tickets.category,
        subcategory: tickets.subcategory,
        status: tickets.status,
        embedding: tickets.embedding,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .where(and(...filters))
      .orderBy(desc(tickets.createdAt))
      .limit(MIN_CANDIDATES);
  } catch {
    return [];
  }
  if (rows.length === 0) return [];

  const docOf = (r: { title: string; summary: string; rootCause: string | null; subcategory: string }) =>
    `${r.title} ${r.summary} ${r.rootCause ?? ""} ${r.subcategory}`.trim();

  const limit = input.limit ?? 4;

  // Semantic path — embed the report and every candidate that lacks a stored
  // vector, then rank by cosine similarity with a small category nudge.
  const reportVec = (await embed([input.text]))?.[0];
  if (reportVec) {
    const missing = rows.filter((r) => !r.embedding);
    if (missing.length) {
      const vectors = await embed(missing.map(docOf));
      if (vectors) {
        missing.forEach((r, i) => {
          r.embedding = vectors[i];
        });
        // Cache vectors so future turns skip the embed cost.
        void cacheEmbeddings(missing.filter((r) => r.embedding).map((r) => ({ id: r.id, embedding: r.embedding! })));
      }
    }
    const scored = rows
      .map((row) => {
        const similarity = row.embedding ? cosine(reportVec, row.embedding) : 0;
        const categoryNudge = input.category && row.category === input.category ? 0.03 : 0;
        return { row, overlap: similarity + categoryNudge };
      })
      .filter((s) => s.overlap >= 0.34)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, limit);
    if (scored.length) return toRelated(scored);
    // Very low similarity across the board: fall through to the lexical path,
    // which at least catches shared identifiers ("Momence", a class name).
  }

  // Lexical fallback (also the no-key path).
  const words = new Set(tokenize(input.text));
  if (words.size === 0) return [];
  const scored = rows
    .map((row) => {
      const rowWords = new Set(tokenize(`${row.title} ${row.summary} ${row.subcategory}`));
      let overlap = 0;
      for (const w of rowWords) if (words.has(w)) overlap += 1;
      if (input.category && row.category === input.category) overlap += 1.5;
      return { row, overlap };
    })
    .filter((s) => s.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit);
  return toRelated(scored);
}

function toRelated(scored: { row: {
  id: number; ticketNumber: string; title: string; category: string; subcategory: string; status: string; createdAt: Date | string;
}; overlap: number }[]): RelatedTicket[] {
  return scored.map(({ row, overlap }) => ({
    id: row.id,
    ticketNumber: row.ticketNumber,
    title: row.title,
    category: row.category,
    subcategory: row.subcategory,
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString().slice(0, 10),
    overlap: Math.round(overlap * 100) / 100,
  }));
}

async function cacheEmbeddings(items: { id: number; embedding: number[] }[]): Promise<void> {
  try {
    const { db } = await import("@/db");
    for (const item of items.slice(0, 40)) {
      await db.update(tickets).set({ embedding: item.embedding }).where(eq(tickets.id, item.id));
    }
  } catch {
    // A failed cache write only costs a re-embed later.
  }
}

/** Backfill embeddings for tickets that lack one (import or admin trigger). */
export async function backfillTicketEmbeddings(batchSize = 60): Promise<number> {
  try {
    const { db } = await import("@/db");
    const rows = await db
      .select({
        id: tickets.id,
        title: tickets.title,
        summary: tickets.summary,
        rootCause: tickets.rootCause,
        subcategory: tickets.subcategory,
      })
      .from(tickets)
      .where(isNotNull(tickets.id))
      .orderBy(desc(tickets.createdAt))
      .limit(400);
    const todo = rows.filter((r) => r.title || r.summary).slice(0, batchSize);
    if (!todo.length) return 0;
    const vectors = await embed(todo.map((r) => `${r.title} ${r.summary} ${r.rootCause ?? ""} ${r.subcategory}`.trim()));
    if (!vectors) return 0;
    for (let i = 0; i < todo.length; i++) {
      await db.update(tickets).set({ embedding: vectors[i] }).where(eq(tickets.id, todo[i].id));
    }
    return todo.length;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Rule-based history for a raised ticket                              */
/* ------------------------------------------------------------------ */

export type SimilarTicket = RelatedTicket & {
  priority: string;
  assigneeName: string | null;
  resolvedAt: string | null;
  /** Why this row was matched, in the words a human would use. */
  reasons: string[];
};

/** How far back "has this happened before?" is worth answering. */
const HISTORY_DAYS = 365;

/**
 * Tickets that look like the same recurring problem as `id`.
 *
 * Deliberately rule-based, not semantic: the owner opening a ticket needs to
 * know *why* two rows are on the same page, and a cosine score cannot tell
 * them. Every match here is explainable — same subcategory at the same studio,
 * the same equipment or area named, the same member. Scores are additive and
 * the reasons ship with the row so the panel can state its case.
 */
export async function findSimilarTickets(id: number, limit = 6): Promise<SimilarTicket[]> {
  let subject: typeof tickets.$inferSelect | undefined;
  let rows: (typeof tickets.$inferSelect)[];
  try {
    const { db } = await import("@/db");
    [subject] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    if (!subject) return [];
    const since = new Date(Date.now() - HISTORY_DAYS * 86400000);
    rows = await db
      .select()
      .from(tickets)
      .where(and(gte(tickets.createdAt, since), eq(tickets.category, subject.category)))
      .orderBy(desc(tickets.createdAt))
      .limit(400);
  } catch {
    return [];
  }

  const subjectText = `${subject.title} ${subject.summary} ${subject.rootCause ?? ""}`;
  const subjectWords = new Set(tokenize(subjectText));
  const subjectThing = namedThings(subjectText);

  const scored: { row: typeof tickets.$inferSelect; score: number; reasons: string[] }[] = [];
  for (const row of rows) {
    if (row.id === id) continue;
    const reasons: string[] = [];
    let score = 0;

    if (row.subcategory === subject.subcategory) {
      score += 3;
      reasons.push(`Same issue type — ${row.subcategory}`);
    } else {
      score += 1;
    }
    if (subject.studioId != null && row.studioId === subject.studioId) {
      score += 2;
      reasons.push(`Same studio — ${row.studioName ?? "this studio"}`);
    }
    if (subject.location && row.location && row.location === subject.location) {
      score += 2;
      reasons.push(`Same area — ${row.location}`);
    }
    if (subject.systemAffected && row.systemAffected === subject.systemAffected) {
      score += 2;
      reasons.push(`Same system — ${row.systemAffected}`);
    }
    if (subject.momenceMemberId && row.momenceMemberId === subject.momenceMemberId) {
      score += 2;
      reasons.push(`Same member — ${row.memberName ?? "this member"}`);
    }
    if (subject.trainerName && row.trainerName === subject.trainerName) {
      score += 1;
      reasons.push(`Same trainer — ${row.trainerName}`);
    }

    // The thing that broke, named in both: "mic", "treadmill 3", "Studio 2".
    const rowText = `${row.title} ${row.summary} ${row.rootCause ?? ""}`;
    const sharedThings = [...namedThings(rowText)].filter((t) => subjectThing.has(t));
    if (sharedThings.length) {
      score += Math.min(3, sharedThings.length * 1.5);
      reasons.push(`Mentions ${sharedThings.slice(0, 3).join(", ")}`);
    }

    const shared = [...new Set(tokenize(rowText))].filter((w) => subjectWords.has(w));
    if (shared.length >= 3) score += Math.min(2, (shared.length - 2) * 0.5);

    // A pair that only shares its category is not a recurrence.
    if (score >= 5 && reasons.length) scored.push({ row, score, reasons });
  }

  return scored
    .sort((a, b) => b.score - a.score || +new Date(b.row.createdAt) - +new Date(a.row.createdAt))
    .slice(0, limit)
    .map(({ row, score, reasons }) => ({
      id: row.id,
      ticketNumber: row.ticketNumber,
      title: row.title,
      category: row.category,
      subcategory: row.subcategory,
      status: row.status,
      priority: row.priority,
      assigneeName: row.assigneeName ?? null,
      createdAt: new Date(row.createdAt).toISOString().slice(0, 10),
      resolvedAt: row.resolvedAt ? new Date(row.resolvedAt).toISOString().slice(0, 10) : null,
      overlap: score,
      reasons,
    }));
}

/**
 * Equipment, room and asset words — the nouns that make two reports the same
 * recurring fault rather than two unrelated ones in the same category.
 */
const THING_WORDS = [
  "mic", "microphone", "speaker", "sound", "music", "aux", "bluetooth", "amplifier",
  "ac", "aircon", "air conditioner", "heater", "fan", "geyser", "boiler",
  "treadmill", "bike", "cycle", "reformer", "chair", "barre", "mat", "weight", "dumbbell",
  "lift", "elevator", "door", "lock", "window", "mirror", "floor", "ceiling", "wall",
  "shower", "washroom", "toilet", "locker", "sink", "tap", "drain", "leak",
  "wifi", "internet", "router", "ipad", "tablet", "laptop", "printer", "pos", "card machine",
  "momence", "app", "website", "booking", "payment", "light", "lighting", "power", "electricity",
];

function namedThings(text: string): Set<string> {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  const found = new Set<string>();
  for (const word of THING_WORDS) if (lower.includes(` ${word} `)) found.add(word);
  // "Studio 2", "treadmill 3" — the specific unit matters more than the class.
  for (const m of lower.matchAll(/\b(studio|room|machine|bike|treadmill|reformer|locker)\s+(\d{1,2})\b/g)) {
    found.add(`${m[1]} ${m[2]}`);
  }
  return found;
}
