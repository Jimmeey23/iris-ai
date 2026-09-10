import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { aiCallStats } from "@/lib/telemetry";
import { getOpenAiKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Observability for the AI layer: per-feature call volume, failure rate,
 * latency percentiles and token spend, plus how often intake fell back from
 * the agent and how reporters treated their drafts.
 */
export async function GET() {
  // Lazy so neither this route nor the build needs a live database at import time.
  const { getSessionUser } = await import("@/lib/session");
  const user = await getSessionUser().catch(() => null);
  if (!user || (user.role !== "admin" && user.role !== "manager")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Imported lazily so the module (and the build) never requires a live
  // DATABASE_URL at collection time.
  const [{ aiCalls, chatSessions }, { db }] = await Promise.all([
    import("@/db/schema"),
    import("@/db"),
  ]);

  const [stats, keyOk, perFeature, recentSessions] = await Promise.all([
    aiCallStats(7),
    getOpenAiKey()
      .then((k) => k.startsWith("sk-"))
      .catch(() => false),
    db
      .select({
        feature: aiCalls.feature,
        calls: sql<number>`count(*)::int`,
        failures: sql<number>`sum(case when ${aiCalls.ok} then 0 else 1 end)::int`,
      })
      .from(aiCalls)
      .where(sql`${aiCalls.createdAt} > now() - interval '7 days'`)
      .groupBy(aiCalls.feature),
    db
      .select({ state: chatSessions.state })
      .from(chatSessions)
      .orderBy(desc(chatSessions.updatedAt))
      .limit(200),
  ]);

  // Draft outcome read from persisted session state (approved / edits / restarts).
  let approved = 0;
  let edited = 0;
  let sessions = 0;
  for (const row of recentSessions) {
    const state = row.state as { outcome?: string; editCount?: number } | null;
    if (!state || typeof state !== "object") continue;
    sessions += 1;
    if (state.outcome === "approved") {
      approved += 1;
      if ((state.editCount ?? 0) > 0) edited += 1;
    }
  }

  return NextResponse.json({
    keyConfigured: keyOk,
    windowDays: 7,
    features: stats.length ? stats : perFeature,
    drafts: { recentSessions: sessions, approved, approvedAfterEdits: edited },
  });
}
