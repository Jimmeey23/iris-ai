import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { trainerEvaluations, trainers } from "@/db/schema";
import {
  FILLOUT_FORMS,
  fetchSubmission,
  fetchSubmissions,
  filloutConfigured,
  formByEmbedId,
  mapSubmission,
  normaliseWebhook,
  type MappedSubmission,
} from "@/lib/fillout";
import { mapFilloutSubmission } from "@/lib/trainer-eval";
import { getSetting, setSetting } from "@/lib/settings";
import { ensureSeeded } from "@/lib/seed";
import { sendEmail } from "@/lib/integrations";

export const dynamic = "force-dynamic";

/** Persist a mapped submission and keep the trainer profile in sync. */
async function persist(m: MappedSubmission): Promise<{ id: number; trainerId: number; created: boolean }> {
  const name = m.trainer.trim() || "Unknown trainer";

  let [trainer] = await db.select().from(trainers).where(eq(trainers.name, name)).limit(1);
  if (!trainer) {
    [trainer] = await db
      .insert(trainers)
      .values({ name, homeStudio: m.studio, formats: [m.template], status: "Active" })
      .returning();
  } else {
    const patch: Record<string, unknown> = {};
    if (!trainer.formats.includes(m.template)) patch.formats = [...trainer.formats, m.template];
    if (!trainer.homeStudio && m.studio) patch.homeStudio = m.studio;
    if (Object.keys(patch).length) await db.update(trainers).set(patch).where(eq(trainers.id, trainer.id));
  }

  const existing = await db
    .select({ id: trainerEvaluations.id })
    .from(trainerEvaluations)
    .where(eq(trainerEvaluations.sourceRef, m.sourceRef))
    .limit(1);

  const row = {
    sourceRef: m.sourceRef,
    trainerId: trainer.id,
    trainerName: name,
    template: m.template,
    studio: m.studio,
    classType: m.classType,
    evaluator: m.evaluator,
    scorePercent: m.scorePercent,
    band: m.band,
    scores: m.scores,
    strengths: m.strengths,
    improvements: m.improvements,
    focusPoints: m.focusPoints,
    goals: m.goals,
    comments: m.comments,
    source: m.source,
    submissionId: m.submissionId,
    formId: m.formId,
    answers: m.answers,
    submittedAt: new Date(m.submittedAt),
  };

  const [saved] = await db
    .insert(trainerEvaluations)
    .values(row)
    .onConflictDoUpdate({ target: trainerEvaluations.sourceRef, set: row })
    .returning();

  const isNew = existing.length === 0;

  // Optional low-score alert.
  if (isNew && m.scorePercent > 0 && m.scorePercent < 65 && (await getSetting("fillout_alert_low")) !== "false") {
    const to = (await getSetting("notify_escalation_to")).split(",")[0]?.trim();
    if (to) {
      void sendEmail({
        to,
        subject: `Coaching priority · ${name} scored ${m.scorePercent}%`,
        category: "trainer-low-score",
        html: `<div style="font-family:Outfit,system-ui,sans-serif;padding:24px;color:#0e1729">
          <div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#5c6578">Training academy alert</div>
          <h1 style="font-family:'Instrument Serif',serif;font-weight:400;font-size:26px;margin:8px 0 4px">${name} — ${m.scorePercent}%</h1>
          <p style="font-size:13px;color:#3c4557">${m.band} on the ${m.template} rubric${m.studio ? ` at ${m.studio}` : ""}${m.evaluator ? `, assessed by ${m.evaluator}` : ""}.</p>
          ${m.improvements.length ? `<p style="font-size:13px;color:#3c4557"><strong>Focus areas:</strong> ${m.improvements.join("; ")}</p>` : ""}
        </div>`,
      }).catch(() => {});
    }
  }

  return { id: saved.id, trainerId: trainer.id, created: isNew };
}

/** Pull recent submissions from every API-pollable form. */
async function syncAll(opts: { full?: boolean } = {}) {
  const since = opts.full ? undefined : (await getSetting("fillout_last_sync")) || undefined;
  let imported = 0;
  let updated = 0;
  const perForm: { form: string; found: number; imported: number; pollable: boolean; note?: string }[] = [];

  for (const form of FILLOUT_FORMS) {
    if (!form.apiPollable) {
      perForm.push({ form: form.name, found: 0, imported: 0, pollable: false, note: "Webhook only — not on the submissions API" });
      continue;
    }
    const subs = await fetchSubmissions(form.embedId, {
      limit: opts.full ? 100 : 25,
      afterDate: since,
    });
    let count = 0;
    for (const sub of subs) {
      const mapped = mapSubmission(sub, form);
      const res = await persist(mapped);
      if (res.created) {
        imported += 1;
        count += 1;
      } else updated += 1;
    }
    perForm.push({ form: form.name, found: subs.length, imported: count, pollable: true });
  }

  await setSetting("fillout_last_sync", new Date().toISOString());
  return { imported, updated, perForm };
}

/* ------------------------------------------------------------------ */
/* Inbound webhook                                                     */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  await ensureSeeded();

  const secret = await getSetting("fillout_webhook_secret");
  if (secret) {
    const header =
      request.headers.get("x-fillout-webhook-secret") ??
      (request.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (header !== secret) return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  try {
    const norm = normaliseWebhook(payload);
    let mapped: MappedSubmission;

    if (norm && norm.submission.questions.length > 0) {
      const form =
        formByEmbedId(norm.formId) ??
        FILLOUT_FORMS.find((f) => f.embedId === norm.formId) ?? {
          embedId: norm.formId || "webhook",
          template: "General" as const,
          name: "Webhook submission",
        };
      mapped = mapSubmission(norm.submission, form, "fillout-webhook");
    } else {
      // Legacy / unknown body shape — fall back to the generic mapper.
      const legacy = mapFilloutSubmission(payload);
      mapped = {
        sourceRef: legacy.sourceRef,
        submissionId: legacy.submissionId,
        formId: legacy.formId,
        formName: "Webhook submission",
        trainer: legacy.trainer,
        template: legacy.template,
        studio: legacy.studio,
        classType: legacy.classType,
        evaluator: legacy.evaluator,
        classAt: "",
        scorePercent: legacy.scorePercent,
        band: legacy.band,
        scores: legacy.scores,
        strengths: legacy.strengths,
        improvements: legacy.improvements,
        focusPoints: legacy.focusPoints,
        goals: legacy.goals,
        comments: legacy.comments,
        answers: legacy.answers,
        submittedAt: legacy.submittedAt,
        source: "fillout-webhook",
      };
    }

    const res = await persist(mapped);
    return NextResponse.json({
      ok: true,
      created: res.created,
      trainerId: res.trainerId,
      evaluationId: res.id,
      trainer: mapped.trainer,
      scorePercent: mapped.scorePercent,
      band: mapped.band,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to ingest submission" },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Listing, polling and manual sync                                    */
/* ------------------------------------------------------------------ */

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") ?? "list";

  if (action === "list") {
    const rows = await db
      .select()
      .from(trainerEvaluations)
      .orderBy(desc(trainerEvaluations.submittedAt))
      .limit(60);
    return NextResponse.json({
      evaluations: rows,
      configured: await filloutConfigured(),
      lastSync: (await getSetting("fillout_last_sync")) || null,
    });
  }

  if (action === "status") {
    return NextResponse.json({
      configured: await filloutConfigured(),
      lastSync: (await getSetting("fillout_last_sync")) || null,
      forms: FILLOUT_FORMS.map((f) => ({
        key: f.key,
        name: f.name,
        embedId: f.embedId,
        pollable: f.apiPollable,
      })),
    });
  }

  if (action === "sync" || action === "historic") {
    if (!(await filloutConfigured())) {
      return NextResponse.json({ ok: false, error: "Add FILLOUT_TOKEN or a Fillout API key in Settings." }, { status: 400 });
    }
    const result = await syncAll({ full: action === "historic" });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "submission") {
    const formId = searchParams.get("formId");
    const submissionId = searchParams.get("submissionId");
    if (!formId || !submissionId) {
      return NextResponse.json({ ok: false, error: "formId and submissionId required" }, { status: 400 });
    }
    const sub = await fetchSubmission(formId, submissionId);
    if (!sub) return NextResponse.json({ ok: false, error: "Submission not found" }, { status: 404 });
    const form = formByEmbedId(formId) ?? { embedId: formId, template: "General" as const, name: "Fillout form" };
    const res = await persist(mapSubmission(sub, form, "fillout-fetch"));
    return NextResponse.json({ ok: true, ...res });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
