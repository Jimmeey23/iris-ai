import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { classFeedback, tickets, trainerEvaluations, trainers } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import TrainerProfile from "@/components/TrainerProfile";

export const dynamic = "force-dynamic";

export default async function TrainerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureSeeded();
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) notFound();

  const [trainer] = await db.select().from(trainers).where(eq(trainers.id, numeric)).limit(1);
  if (!trainer) notFound();

  const [evals, allTickets, feedback] = await Promise.all([
    db
      .select()
      .from(trainerEvaluations)
      .where(eq(trainerEvaluations.trainerName, trainer.name))
      .orderBy(desc(trainerEvaluations.submittedAt)),
    db.select().from(tickets),
    db.select().from(classFeedback),
  ]);

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-6 sm:px-6">
      <Link href="/trainers" className="inline-flex items-center gap-1.5 text-[12px] font-medium txt-3 transition hover:accent-txt">
        ← Back to trainers
      </Link>
      <TrainerProfile
        trainer={trainer}
        evaluations={evals}
        tickets={allTickets.filter((t) => (t.trainerName ?? "").toLowerCase() === trainer.name.toLowerCase())}
        classes={feedback.filter((f) => f.trainerName.toLowerCase() === trainer.name.toLowerCase())}
      />
    </div>
  );
}
