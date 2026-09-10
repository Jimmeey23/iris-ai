import { and, desc, eq, or } from "drizzle-orm";

/**
 * Lightweight studio/member memory.
 *
 * When a ticket is raised, a one-line fact is remembered about the studio (and
 * the member, when there is one). Future intake conversations are injected with
 * these facts, so the assistant stops asking what the organisation already
 * knows — "is this the same AC that broke last week?" instead of a blank slate.
 *
 * Facts are context, not truth: the prompt labels them as possibly stale and
 * the agent must verify against what the reporter actually says.
 */

export type FactScope = "studio" | "member" | "org";

/** Facts relevant to this intake, newest first, capped and de-duplicated. */
export async function findContextFacts(input: {
  studioId?: number | null;
  memberName?: string;
  limit?: number;
}): Promise<string[]> {
  try {
    const [{ db }, { contextFacts }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    const conds = [];
    if (typeof input.studioId === "number") {
      conds.push(and(eq(contextFacts.scope, "studio"), eq(contextFacts.refKey, String(input.studioId))));
    }
    const memberKey = input.memberName?.trim().toLowerCase();
    if (memberKey && memberKey !== "anonymous member") {
      conds.push(and(eq(contextFacts.scope, "member"), eq(contextFacts.refKey, memberKey)));
    }
    if (conds.length === 0) return [];
    const rows = await db
      .select({ fact: contextFacts.fact })
      .from(contextFacts)
      .where(conds.length === 1 ? conds[0] : or(...conds))
      .orderBy(desc(contextFacts.createdAt))
      .limit(input.limit ?? 8);
    return rows.map((r) => r.fact).filter(Boolean);
  } catch {
    return [];
  }
}

/** Remember one fact. Exact duplicates are skipped; failures are silent. */
export async function rememberFact(
  scope: FactScope,
  refKey: string,
  fact: string,
  sourceTicketNumber?: string,
): Promise<void> {
  const clean = fact.trim().slice(0, 400);
  if (!clean || !refKey.trim()) return;
  try {
    const [{ db }, { contextFacts }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    const { sql } = await import("drizzle-orm");
    const [existing] = await db
      .select({ id: contextFacts.id })
      .from(contextFacts)
      .where(
        and(
          eq(contextFacts.scope, scope),
          eq(contextFacts.refKey, refKey.trim().toLowerCase()),
          eq(contextFacts.fact, clean),
        ),
      )
      .limit(1);
    if (existing) return;
    await db.insert(contextFacts).values({
      scope,
      refKey: refKey.trim().toLowerCase(),
      fact: clean,
      sourceTicketNumber: sourceTicketNumber ?? null,
    });
    // Keep each scope/key ring buffer small — the newest facts are the useful ones.
    await db.execute(sql`
      delete from context_facts
      where scope = ${scope} and ref_key = ${refKey.trim().toLowerCase()}
        and id not in (
          select id from context_facts
          where scope = ${scope} and ref_key = ${refKey.trim().toLowerCase()}
          order by created_at desc limit 20
        )
    `);
  } catch {
    // Memory is an optimisation, never a dependency.
  }
}
