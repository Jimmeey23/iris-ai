import { sql } from "drizzle-orm";

/**
 * AI call telemetry. Every model call records one row here so quality, cost
 * and degradation are observable instead of anecdotal. Writes are best-effort:
 * telemetry must never break the call it observes.
 */

export type AiCallRecord = {
  feature: string;
  model?: string;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  sessionId?: string;
};

export async function recordAiCall(rec: AiCallRecord): Promise<void> {
  try {
    const [{ db }, { aiCalls }] = await Promise.all([import("@/db"), import("@/db/schema")]);
    await db.insert(aiCalls).values({
      feature: rec.feature || "unknown",
      model: rec.model ?? null,
      ok: rec.ok,
      error: rec.error ?? null,
      latencyMs: rec.latencyMs ?? null,
      inputTokens: rec.inputTokens ?? null,
      outputTokens: rec.outputTokens ?? null,
      sessionId: rec.sessionId ?? null,
    });
  } catch {
    // Never let observability take down the product.
  }
}

export type AiFeatureStat = {
  feature: string;
  calls: number;
  failures: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

/** Aggregate per-feature stats over the trailing window, for the admin view. */
export async function aiCallStats(days = 7): Promise<AiFeatureStat[]> {
  try {
    const { db } = await import("@/db");
    const { aiCalls } = await import("@/db/schema");
    const rows = await db
      .select({
        feature: aiCalls.feature,
        calls: sql<number>`count(*)::int`,
        failures: sql<number>`sum(case when ${aiCalls.ok} then 0 else 1 end)::int`,
        avgLatencyMs: sql<number>`coalesce(round(avg(${aiCalls.latencyMs})), 0)::int`,
        p95LatencyMs: sql<number>`coalesce(round(percentile_cont(0.95) within group (order by ${aiCalls.latencyMs})), 0)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::int`,
      })
      .from(aiCalls)
      .where(sql`${aiCalls.createdAt} > now() - (${days} || ' days')::interval`)
      .groupBy(aiCalls.feature)
      .orderBy(sql`count(*) desc`);
    return rows;
  } catch {
    return [];
  }
}
