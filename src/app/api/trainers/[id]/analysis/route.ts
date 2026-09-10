import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { classFeedback, tickets, trainerAnalysis, trainerEvaluations, trainers } from "@/db/schema";
import { getOpenAiKey } from "@/lib/settings";
import { chatJson, modelFor } from "@/lib/llm";
import { linearFit } from "@/lib/forecast";

export const dynamic = "force-dynamic";

type Analysis = {
  headline: string;
  narrative: string;
  strengths: string[];
  priorities: string[];
  coachingPlan: { horizon: string; action: string }[];
  trajectory: string;
  risk: "high" | "watch" | "stable" | "rising";
  engine: string;
};

function localAnalysis(input: {
  name: string;
  scores: number[];
  band: string;
  rubric: { category: string; pct: number }[];
  positives: number;
  negatives: number;
  hosted: number;
  studio: string;
  formats: string[];
}): Analysis {
  const { slope } = linearFit(input.scores);
  const latest = input.scores.at(-1) ?? 0;
  const avg = input.scores.length
    ? Math.round(input.scores.reduce((a, b) => a + b, 0) / input.scores.length)
    : 0;
  const projected = Math.max(0, Math.min(100, Math.round(latest + slope * 2)));

  const risk: Analysis["risk"] =
    latest < 65 || projected < 65 ? "high" : slope < -2 ? "watch" : slope > 2 ? "rising" : "stable";

  const weakest = [...input.rubric].sort((a, b) => a.pct - b.pct).slice(0, 3);
  const strongest = [...input.rubric].sort((a, b) => b.pct - a.pct).slice(0, 3);

  const direction =
    slope > 2 ? "improving steadily" : slope < -2 ? "regressing" : "holding steady";

  const headline =
    risk === "high"
      ? `${input.name} needs focused coaching support`
      : risk === "rising"
        ? `${input.name} is on a strong upward trajectory`
        : risk === "watch"
          ? `${input.name} has slipped and warrants a check-in`
          : `${input.name} is performing consistently`;

  const narrative = [
    `${input.name} holds a ${avg}% weighted average across ${input.scores.length} assessment${input.scores.length === 1 ? "" : "s"}, with the most recent at ${latest}% (${input.band}).`,
    `The trajectory is ${direction} at ${slope >= 0 ? "+" : ""}${Math.round(slope * 10) / 10} points per review, projecting roughly ${projected}% at the next assessment.`,
    input.negatives > 0
      ? `Member feedback shows ${input.negatives} negative or escalated mention${input.negatives === 1 ? "" : "s"} against ${input.positives} positive, which ${input.negatives > input.positives ? "corroborates" : "partially offsets"} the rubric picture.`
      : input.positives > 0
        ? `Member feedback is entirely positive with ${input.positives} commendation${input.positives === 1 ? "" : "s"} logged and no negatives.`
        : "No member-facing feedback has been logged against this trainer yet.",
    input.hosted > 0 ? `They have led ${input.hosted} hosted or community class${input.hosted === 1 ? "" : "es"}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    headline,
    narrative,
    strengths: strongest.map((s) => `${s.category} — sustaining ${s.pct}% attainment`),
    priorities: weakest.map((s) => `${s.category} at ${s.pct}% — the largest single gap to close`),
    coachingPlan: [
      { horizon: "This week", action: weakest[0] ? `Observe one class focused solely on ${weakest[0].category.toLowerCase()}.` : "Run a standard class observation." },
      { horizon: "This month", action: weakest[1] ? `Pair with a peer strong in ${weakest[1].category.toLowerCase()} and co-teach once.` : "Set two measurable rubric targets." },
      { horizon: "Next review", action: `Target ${Math.min(100, Math.max(latest + 8, 75))}% overall, with no criterion below 70%.` },
    ],
    trajectory: `${slope >= 0 ? "+" : ""}${Math.round(slope * 10) / 10} pts/review · projecting ${projected}%`,
    risk,
    engine: "Iris analysis (on-device)",
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trainerId = Number(id);
  const forceRefresh = new URL(req.url).searchParams.get("refresh") === "1";
  const [trainer] = await db.select().from(trainers).where(eq(trainers.id, trainerId)).limit(1);
  if (!trainer) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [evals, allTickets, feedback] = await Promise.all([
    db
      .select()
      .from(trainerEvaluations)
      .where(eq(trainerEvaluations.trainerName, trainer.name))
      .orderBy(desc(trainerEvaluations.submittedAt)),
    db.select().from(tickets),
    db.select().from(classFeedback),
  ]);

  const latestEvalId = evals[0]?.id ?? null;
  if (!forceRefresh) {
    const [cached] = await db.select().from(trainerAnalysis).where(eq(trainerAnalysis.trainerId, trainerId)).limit(1);
    if (cached && cached.evalCount === evals.length && cached.latestEvalId === latestEvalId) {
      const { headline, narrative, strengths, priorities, coachingPlan, trajectory, risk, engine } = cached;
      return NextResponse.json({ headline, narrative, strengths, priorities, coachingPlan, trajectory, risk, engine });
    }
  }

  const myTickets = allTickets.filter(
    (t) => (t.trainerName ?? "").toLowerCase() === trainer.name.toLowerCase(),
  );
  const sorted = [...evals].sort(
    (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
  );

  const rubricMap = new Map<string, { score: number; weight: number }>();
  for (const e of evals) {
    for (const s of e.scores ?? []) {
      const cur = rubricMap.get(s.category) ?? { score: 0, weight: 0 };
      cur.score += s.score;
      cur.weight += s.weightage;
      rubricMap.set(s.category, cur);
    }
  }
  const rubric = [...rubricMap.entries()].map(([category, v]) => ({
    category,
    pct: v.weight > 0 ? Math.round((v.score / v.weight) * 100) : 0,
  }));

  const base = localAnalysis({
    name: trainer.name,
    scores: sorted.map((e) => e.scorePercent),
    band: evals[0]?.band ?? "Not assessed",
    rubric,
    positives: myTickets.filter((t) => t.sentiment === "Positive").length,
    negatives: myTickets.filter((t) => t.sentiment === "Negative" || t.sentiment === "Escalated").length,
    hosted: feedback.filter((f) => f.trainerName.toLowerCase() === trainer.name.toLowerCase()).length,
    studio: trainer.homeStudio,
    formats: trainer.formats,
  });

  const persist = async (a: Analysis) => {
    await db
      .insert(trainerAnalysis)
      .values({ trainerId, ...a, evalCount: evals.length, latestEvalId })
      .onConflictDoUpdate({
        target: trainerAnalysis.trainerId,
        set: { ...a, evalCount: evals.length, latestEvalId, generatedAt: new Date() },
      });
    return a;
  };

  const key = await getOpenAiKey();
  if (!key.startsWith("sk-") || evals.length === 0) {
    return NextResponse.json(await persist(base));
  }

  const model = await modelFor("reason");
  {
    const res = await chatJson<Analysis>({
      system:
        "You are the head of training at Physique 57, a boutique barre studio group in India. Write a candid, specific performance analysis for one instructor. Return JSON {headline, narrative, strengths[], priorities[], coachingPlan:[{horizon,action}]}. headline is at most 10 words and must not repeat the word 'Performance Analysis'. narrative is 3-4 sentences of prose. strengths and priorities are 3 items each, each naming a rubric criterion and its attainment number. coachingPlan has exactly 3 entries with horizons 'This week', 'This month', 'Next review'. Be direct, never generic, use British English, never invent data. Do not return a trajectory field.",
      user: JSON.stringify({
        trainer: trainer.name,
        studio: trainer.homeStudio,
        formats: trainer.formats,
        assessments: sorted.map((e) => ({
          at: e.submittedAt,
          score: e.scorePercent,
          band: e.band,
          template: e.template,
          evaluator: e.evaluator,
          focus: e.focusPoints,
          comments: e.comments,
        })),
        rubricAttainment: rubric,
        memberFeedback: {
          positive: myTickets.filter((t) => t.sentiment === "Positive").length,
          negative: myTickets.filter((t) => t.sentiment === "Negative" || t.sentiment === "Escalated").length,
          themes: [...new Set(myTickets.map((t) => t.subcategory))].slice(0, 6),
        },
      }),
      tier: "reason",
      temperature: 0.35,
      maxTokens: 900,
      timeoutMs: 22000,
      retries: 0,
      feature: "trainer-analysis",
    });
    const parsed = res.data;
    if (!res.ok || !parsed) return NextResponse.json(await persist(base));
    const merged: Analysis = {
      ...base,
      headline: parsed.headline?.trim() || base.headline,
      narrative: parsed.narrative?.trim() || base.narrative,
      strengths: parsed.strengths?.length ? parsed.strengths.slice(0, 4) : base.strengths,
      priorities: parsed.priorities?.length ? parsed.priorities.slice(0, 4) : base.priorities,
      coachingPlan: parsed.coachingPlan?.length ? parsed.coachingPlan.slice(0, 3) : base.coachingPlan,
      trajectory: base.trajectory,
      risk: base.risk,
      engine: `OpenAI ${model}`,
    };
    return NextResponse.json(await persist(merged));
  }
}
