import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { tokenize } from "./ai";

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

/**
 * Recent tickets that look like the same underlying problem.
 *
 * Scoped to the studio when known, then ranked by token overlap with the new
 * report. Feeds the agent so it can say "third AC ticket at Kemps this month"
 * instead of treating every intake as a blank slate.
 */
export async function findRelatedTickets(input: {
  text: string;
  studioId?: number | null;
  category?: string;
  limit?: number;
}): Promise<RelatedTicket[]> {
  const words = new Set(tokenize(input.text));
  if (words.size === 0) return [];

  const since = new Date(Date.now() - WINDOW_DAYS * 86400000);
  const filters = [gte(tickets.createdAt, since)];
  if (typeof input.studioId === "number") filters.push(eq(tickets.studioId, input.studioId));

  let rows;
  try {
    rows = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        title: tickets.title,
        summary: tickets.summary,
        category: tickets.category,
        subcategory: tickets.subcategory,
        status: tickets.status,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .where(and(...filters))
      .orderBy(desc(tickets.createdAt))
      .limit(150);
  } catch {
    return [];
  }

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
    .slice(0, input.limit ?? 4);

  return scored.map(({ row, overlap }) => ({
    id: row.id,
    ticketNumber: row.ticketNumber,
    title: row.title,
    category: row.category,
    subcategory: row.subcategory,
    status: row.status,
    createdAt: new Date(row.createdAt).toISOString().slice(0, 10),
    overlap,
  }));
}
