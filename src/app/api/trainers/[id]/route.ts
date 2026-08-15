import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { classFeedback, tickets, trainerEvaluations, trainers } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded();
  const { id } = await params;
  const [trainer] = await db.select().from(trainers).where(eq(trainers.id, Number(id))).limit(1);
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

  return NextResponse.json({
    trainer,
    evaluations: evals,
    tickets: allTickets.filter((t) => (t.trainerName ?? "").toLowerCase() === trainer.name.toLowerCase()),
    classes: feedback.filter((f) => f.trainerName.toLowerCase() === trainer.name.toLowerCase()),
  });
}
