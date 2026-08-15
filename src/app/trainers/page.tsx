import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { classFeedback, tickets, trainerEvaluations, trainers } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { syncTrainersFromMomence } from "@/app/api/trainers/route";
import { bandTone } from "@/lib/trainer-eval";
import { Avatar, EmptyState, PageHeader, Panel, timeAgo } from "@/components/ui";
import FilloutSync from "@/components/FilloutSync";

export const dynamic = "force-dynamic";

export default async function TrainersPage() {
  await ensureSeeded();
  await syncTrainersFromMomence();

  const [rows, evals, allTickets, feedback] = await Promise.all([
    db.select().from(trainers).orderBy(asc(trainers.name)),
    db.select().from(trainerEvaluations).orderBy(desc(trainerEvaluations.submittedAt)),
    db.select().from(tickets),
    db.select().from(classFeedback),
  ]);

  const profiles = rows.map((t) => {
    const myEvals = evals.filter((e) => e.trainerName.toLowerCase() === t.name.toLowerCase());
    const myTickets = allTickets.filter((x) => (x.trainerName ?? "").toLowerCase() === t.name.toLowerCase());
    return {
      trainer: t,
      evaluations: myEvals.length,
      avg: myEvals.length ? Math.round(myEvals.reduce((s, e) => s + e.scorePercent, 0) / myEvals.length) : null,
      latest: myEvals[0] ?? null,
      mentions: myTickets.length,
      negatives: myTickets.filter((x) => x.sentiment === "Negative" || x.sentiment === "Escalated").length,
      hosted: feedback.filter((f) => f.trainerName.toLowerCase() === t.name.toLowerCase()).length,
    };
  });

  const ranked = [...profiles].sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.mentions - a.mentions);
  const reviewed = profiles.filter((p) => p.evaluations > 0);
  const teamAvg = reviewed.length ? Math.round(reviewed.reduce((s, p) => s + (p.avg ?? 0), 0) / reviewed.length) : 0;
  const needsCoaching = reviewed.filter((p) => (p.avg ?? 100) < 75).length;

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Training academy"
        title="Trainers"
        description="Every instructor synced from Momence, with weighted evaluation scores, member sentiment and hosted-class outcomes rolled into one profile."
        action={<FilloutSync />}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { l: "Trainers on roster", v: rows.length, tone: "var(--accent)" },
          { l: "Assessed", v: reviewed.length, tone: "var(--accent)" },
          { l: "Team average", v: `${teamAvg}%`, tone: teamAvg >= 80 ? "var(--mint)" : "var(--warn)" },
          { l: "Coaching priority", v: needsCoaching, tone: needsCoaching ? "var(--danger)" : "var(--mint)" },
        ].map((k) => (
          <div key={k.l} className="panel rounded-2xl p-4">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.13em] txt-3">{k.l}</div>
            <div className="serif mt-2 text-[30px] leading-none tabular" style={{ color: k.tone }}>
              {k.v}
            </div>
          </div>
        ))}
      </div>

      <Panel title="Trainer roster" subtitle="Sorted by evaluation score" padded={false}>
        {ranked.length === 0 ? (
          <EmptyState title="No trainers yet" body="Sync from Momence or submit a Fillout evaluation." />
        ) : (
          <div className="grid gap-px sm:grid-cols-2 xl:grid-cols-3" style={{ background: "var(--line)" }}>
            {ranked.map(({ trainer, evaluations, avg, latest, mentions, negatives, hosted }) => (
              <Link
                key={trainer.id}
                href={`/trainers/${trainer.id}`}
                className="group flex items-center gap-3 p-4 transition"
                style={{ background: "var(--surface)" }}
              >
                {trainer.pictureUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={trainer.pictureUrl} alt={trainer.name} className="h-11 w-11 rounded-xl object-cover" />
                ) : (
                  <Avatar name={trainer.name} size={44} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold txt group-hover:accent-txt">{trainer.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {latest ? (
                      <span className={`chip ${bandTone(latest.band)} !text-[9px]`}>{latest.band}</span>
                    ) : (
                      <span className="chip !text-[9px]" style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                        Not assessed
                      </span>
                    )}
                    {negatives > 0 && <span className="chip danger-soft !text-[9px]">{negatives} flags</span>}
                    {hosted > 0 && <span className="chip accent-soft !text-[9px]">{hosted} hosted</span>}
                  </div>
                  <div className="mt-1 text-[10px] txt-3">
                    {evaluations} review{evaluations === 1 ? "" : "s"} · {mentions} mention{mentions === 1 ? "" : "s"}
                    {latest ? ` · ${timeAgo(latest.submittedAt)} ago` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div
                    className="serif text-[22px] leading-none tabular"
                    style={{ color: avg == null ? "var(--text-3)" : avg >= 80 ? "var(--mint)" : avg >= 65 ? "var(--accent)" : "var(--danger)" }}
                  >
                    {avg == null ? "—" : `${avg}%`}
                  </div>
                  <div className="mt-0.5 text-[8.5px] uppercase tracking-[0.12em] txt-3">avg</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
