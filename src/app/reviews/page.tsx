import { desc } from "drizzle-orm";
import { db } from "@/db";
import { trainerEvaluations } from "@/db/schema";
import TrainerReviews from "@/components/TrainerReviews";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { filloutConfigured } from "@/lib/fillout";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  await ensureSeeded();
  const [rows, configured, lastSync] = await Promise.all([
    db.select().from(trainerEvaluations).orderBy(desc(trainerEvaluations.submittedAt)).limit(200),
    filloutConfigured(),
    getSetting("fillout_last_sync"),
  ]);

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Historic reviews"
        title="Reviews"
        description="Every evaluation submitted across all forms, synced live from Fillout — plus manual entries. Open a trainer's profile for the full, filterable report."
        action={<span className="chip chip-line">{rows.length} on file</span>}
      />
      <TrainerReviews
        recent={rows.map((r) => ({
          id: r.id,
          trainerId: r.trainerId,
          trainerName: r.trainerName,
          template: r.template,
          scorePercent: r.scorePercent,
          band: r.band,
          studio: r.studio,
          evaluator: r.evaluator,
          submittedAt: r.submittedAt as unknown as string,
          source: r.source,
        }))}
        configured={configured}
        lastSync={lastSync || null}
      />
    </div>
  );
}
