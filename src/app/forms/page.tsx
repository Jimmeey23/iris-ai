import { desc } from "drizzle-orm";
import { db } from "@/db";
import { trainerEvaluations } from "@/db/schema";
import FilloutForms from "@/components/FilloutForms";
import { PageHeader } from "@/components/ui";
import { ensureSeeded } from "@/lib/seed";
import { FILLOUT_FORMS, filloutConfigured } from "@/lib/fillout";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function FormsPage() {
  await ensureSeeded();
  const [rows, configured, lastSync] = await Promise.all([
    db.select().from(trainerEvaluations).orderBy(desc(trainerEvaluations.submittedAt)).limit(60),
    filloutConfigured(),
    getSetting("fillout_last_sync"),
  ]);

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Evaluation forms"
        title="Forms"
        description="The four live Fillout forms embedded in-app. Submissions are listened for over webhook and pulled from the Fillout API, then scored against the weighted rubric and written onto the trainer profile."
        action={
          <div className="flex items-center gap-2">
            <span className="chip chip-line">{FILLOUT_FORMS.length} forms</span>
            <a href="/settings" className="btn btn-ghost">Configure</a>
          </div>
        }
      />
      <FilloutForms
        forms={FILLOUT_FORMS.map((f) => ({
          key: f.key,
          name: f.name,
          blurb: f.blurb,
          template: f.template,
          embedId: f.embedId,
          embedKind: f.embedKind,
          height: f.height,
          icon: f.icon,
          apiPollable: f.apiPollable,
        }))}
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
