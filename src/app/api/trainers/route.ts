import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { classFeedback, tickets, trainerEvaluations, trainers } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { getDirectory } from "@/lib/momence";

export const dynamic = "force-dynamic";

/** Merge the Momence teacher directory into the local trainer table. */
export async function syncTrainersFromMomence(): Promise<number> {
  try {
    const dir = await getDirectory();
    if (dir.trainers.length === 0) return 0;
    const existing = await db.select().from(trainers);
    const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
    let added = 0;
    for (const t of dir.trainers) {
      const found = byName.get(t.name.toLowerCase());
      if (found) {
        if (!found.momenceTeacherId || (!found.pictureUrl && t.pictureUrl)) {
          await db
            .update(trainers)
            .set({ momenceTeacherId: t.id, pictureUrl: t.pictureUrl ?? found.pictureUrl })
            .where(eq(trainers.id, found.id));
        }
        continue;
      }
      await db.insert(trainers).values({
        momenceTeacherId: t.id,
        name: t.name,
        pictureUrl: t.pictureUrl,
        homeStudio: "",
        formats: [],
        status: "Active",
      });
      added += 1;
    }
    return added;
  } catch {
    return 0;
  }
}

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  if (searchParams.get("sync") === "1") await syncTrainersFromMomence();

  const [rows, evals, allTickets, feedback] = await Promise.all([
    db.select().from(trainers).orderBy(asc(trainers.name)),
    db.select().from(trainerEvaluations).orderBy(desc(trainerEvaluations.submittedAt)),
    db.select().from(tickets),
    db.select().from(classFeedback),
  ]);

  const profiles = rows.map((trainer) => {
    const myEvals = evals.filter(
      (e) => e.trainerId === trainer.id || e.trainerName.toLowerCase() === trainer.name.toLowerCase(),
    );
    const myTickets = allTickets.filter(
      (t) => (t.trainerName ?? "").toLowerCase() === trainer.name.toLowerCase(),
    );
    const myClasses = feedback.filter(
      (f) => f.trainerName.toLowerCase() === trainer.name.toLowerCase(),
    );
    const avgScore = myEvals.length
      ? Math.round(myEvals.reduce((s, e) => s + e.scorePercent, 0) / myEvals.length)
      : null;
    return {
      ...trainer,
      evaluations: myEvals.length,
      avgScore,
      latestScore: myEvals[0]?.scorePercent ?? null,
      latestBand: myEvals[0]?.band ?? null,
      lastReviewedAt: myEvals[0]?.submittedAt ?? null,
      ticketMentions: myTickets.length,
      positiveMentions: myTickets.filter((t) => t.sentiment === "Positive").length,
      negativeMentions: myTickets.filter((t) => t.sentiment === "Negative" || t.sentiment === "Escalated").length,
      hostedClasses: myClasses.length,
    };
  });

  return NextResponse.json({ trainers: profiles });
}
