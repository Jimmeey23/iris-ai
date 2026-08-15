import { NextResponse } from "next/server";
import { db } from "@/db";
import { tickets, trainerEvaluations } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { buildForecast } from "@/lib/forecast";
import { getOpenAiKey, getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const windowDays = Math.max(14, Math.min(180, Number(searchParams.get("window") ?? 60)));

  const [allTickets, evals] = await Promise.all([
    db.select().from(tickets),
    db.select().from(trainerEvaluations),
  ]);

  const includeHistoric = searchParams.get("historic") === "1";
  const bundle = buildForecast(allTickets, evals, windowDays, { includeHistoric });

  // Optional LLM narrative over the computed signals.
  let narrative: string | null = null;
  let engine = "Iris forecasting (on-device)";
  const key = await getOpenAiKey();
  if (key.startsWith("sk-") && searchParams.get("narrative") !== "0") {
    const model = (await getSetting("openai_model")) || "gpt-4o-mini";
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          max_tokens: 320,
          messages: [
            {
              role: "system",
              content:
                "You are the operations analyst for Physique 57, a boutique barre studio group in India. Given computed forecast signals, write a 3-4 sentence executive briefing for the leadership team. Lead with the single most important thing, quantify it, and finish with the one action to take this week. British English, no bullet points, no preamble.",
            },
            {
              role: "user",
              content: JSON.stringify({
                volume: bundle.volume,
                backlog: bundle.backlog,
                slaRisk: {
                  atRisk: bundle.slaRisk.atRisk.length,
                  breachedNow: bundle.slaRisk.breachedNow,
                  predicted: bundle.slaRisk.predictedBreaches7,
                  compliance: bundle.slaRisk.complianceForecast,
                },
                churn: bundle.churn.members.slice(0, 4),
                trainersAtRisk: bundle.trainers.filter((t) => t.risk === "high" || t.risk === "watch").slice(0, 4),
                hotspots: bundle.hotspots.slice(0, 4),
                signals: bundle.signals.slice(0, 6).map((s) => ({ t: s.title, d: s.detail })),
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(18000),
      });
      if (res.ok) {
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        narrative = json.choices?.[0]?.message?.content?.trim() ?? null;
        if (narrative) engine = `OpenAI ${model}`;
      }
    } catch {
      /* fall back to computed signals only */
    }
  }

  if (!narrative) {
    const top = bundle.signals[0];
    narrative = top
      ? `${top.title}. ${top.detail}${top.action ? ` ${top.action}` : ""}`
      : "No material signals detected in this window — volume, SLA compliance and trainer scores are all within normal range.";
  }

  return NextResponse.json({ ...bundle, narrative, engine });
}
