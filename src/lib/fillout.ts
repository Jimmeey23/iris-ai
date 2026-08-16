import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customFilloutForms } from "@/db/schema";
import { getSetting } from "./settings";
import { RUBRICS, performanceBand, summariseScores, type ScoreRow } from "./trainer-eval";
import type { TrainerTemplate } from "./catalog";

/* ------------------------------------------------------------------ */
/* Form registry — matches the embeds rendered on /forms               */
/* ------------------------------------------------------------------ */

export type EmbedKind = "fillout-v1" | "zite-v2";

export type FilloutForm = {
  key: string;
  name: string;
  blurb: string;
  /** Rubric this form scores against. */
  template: TrainerTemplate;
  /** id used by the embed script AND the public API where supported. */
  embedId: string;
  embedKind: EmbedKind;
  height: number;
  icon: string;
  /** Zite forms are not exposed on the submissions API — webhook only. */
  apiPollable: boolean;
};

export const FILLOUT_FORMS: FilloutForm[] = [
  {
    key: "strength",
    name: "Strength Lab feedback",
    blurb: "Trainer QA & Assessment — FIT & Strength Lab",
    template: "Strength Lab",
    embedId: "srq1c6n7br",
    embedKind: "zite-v2",
    height: 700,
    icon: "◈",
    apiPollable: false,
  },
  {
    key: "cycle",
    name: "powerCycle feedback",
    blurb: "Ride programming, musicality, safety and fill rate",
    template: "powerCycle",
    embedId: "pdtcpzhxas",
    embedKind: "zite-v2",
    height: 700,
    icon: "◎",
    apiPollable: false,
  },
  {
    key: "barre",
    name: "Barre assessment",
    blurb: "Training Quality Assessment — weighted Barre rubric",
    template: "Barre",
    embedId: "dSw2VkfdGqus",
    embedKind: "fillout-v1",
    height: 500,
    icon: "◑",
    apiPollable: true,
  },
  {
    key: "nontechnical",
    name: "Non-technical feedback",
    blurb: "Member-facing class experience and retention signals",
    template: "General",
    embedId: "syTsvPww8nus",
    embedKind: "fillout-v1",
    height: 500,
    icon: "▤",
    apiPollable: true,
  },
];

export function formByEmbedId(id: string): FilloutForm | undefined {
  return FILLOUT_FORMS.find((f) => f.embedId === id);
}

/** The four built-in forms plus any active user-added forms, as one list for the /forms board. */
export async function getAllForms(): Promise<FilloutForm[]> {
  const custom = await db
    .select()
    .from(customFilloutForms)
    .where(eq(customFilloutForms.active, true))
    .orderBy(asc(customFilloutForms.name));
  return [
    ...FILLOUT_FORMS,
    ...custom.map((c) => ({
      key: c.slug,
      name: c.name,
      blurb: c.blurb,
      template: c.template as TrainerTemplate,
      embedId: c.embedId,
      embedKind: c.embedKind as EmbedKind,
      height: c.height,
      icon: c.icon,
      apiPollable: false,
    })),
  ];
}

/**
 * Pulls the embed id + kind out of whatever a user pastes: a full Fillout/Zite
 * embed snippet, or a bare form id (assumed Fillout v1).
 */
export function extractEmbed(input: string): { embedId: string; embedKind: EmbedKind } | null {
  const raw = input.trim();
  if (!raw) return null;
  const ziteMatch = raw.match(/data-zite-id=["']([a-zA-Z0-9]+)["']/);
  if (ziteMatch) return { embedId: ziteMatch[1], embedKind: "zite-v2" };
  const filloutMatch = raw.match(/data-fillout-id=["']([a-zA-Z0-9]+)["']/);
  if (filloutMatch) return { embedId: filloutMatch[1], embedKind: "fillout-v1" };
  const urlMatch = raw.match(/fillout\.com\/(?:t|p)\/([a-zA-Z0-9]+)/);
  if (urlMatch) return { embedId: urlMatch[1], embedKind: "fillout-v1" };
  if (/^[a-zA-Z0-9]+$/.test(raw)) return { embedId: raw, embedKind: "fillout-v1" };
  return null;
}

/* ------------------------------------------------------------------ */
/* API client                                                          */
/* ------------------------------------------------------------------ */

async function credentials() {
  const token = (await getSetting("fillout_api_key")) || process.env.FILLOUT_TOKEN || "";
  const base = (
    (await getSetting("fillout_base_url")) ||
    process.env.FILLOUT_BASE_URL ||
    "https://api.fillout.com/v1/api"
  ).replace(/\/$/, "");
  return { token, base };
}

export async function filloutConfigured(): Promise<boolean> {
  const { token } = await credentials();
  return token.length > 8;
}

type ApiQuestion = { id: string; name: string; type: string; value: unknown };
type ApiCalculation = { id: string; name: string; type: string; value: number };

export type ApiSubmission = {
  submissionId: string;
  submissionTime: string;
  lastUpdatedAt?: string;
  questions: ApiQuestion[];
  calculations?: ApiCalculation[];
  urlParameters?: { name: string; value: string }[];
};

async function apiGet<T>(path: string): Promise<T | null> {
  const { token, base } = await credentials();
  if (!token) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function listForms(): Promise<{ formId: string; name: string; isPublished: boolean }[]> {
  const data = await apiGet<{ formId: string; name: string; isPublished: boolean }[]>("/forms");
  return data ?? [];
}

export async function fetchSubmissions(
  formId: string,
  opts: { limit?: number; afterDate?: string } = {},
): Promise<ApiSubmission[]> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 25),
    sort: "desc",
  });
  if (opts.afterDate) params.set("afterDate", opts.afterDate);
  const data = await apiGet<{ responses?: ApiSubmission[]; totalResponses?: number }>(
    `/forms/${formId}/submissions?${params}`,
  );
  return data?.responses ?? [];
}

export async function fetchSubmission(formId: string, submissionId: string): Promise<ApiSubmission | null> {
  const data = await apiGet<{ submission?: ApiSubmission } | ApiSubmission>(
    `/forms/${formId}/submissions/${submissionId}`,
  );
  if (!data) return null;
  return (data as { submission?: ApiSubmission }).submission ?? (data as ApiSubmission);
}

/* ------------------------------------------------------------------ */
/* Mapping — real Physique 57 question shape                           */
/* ------------------------------------------------------------------ */

const SCORE_MARKER = /^[❖◆•*\s]*/;

function clean(name: string): string {
  return name.replace(SCORE_MARKER, "").replace(/\s*\(\d+\)\s*$/, "").replace(/\t/g, " ").trim();
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return String(value);
}

function findQ(questions: ApiQuestion[], patterns: RegExp[]): string {
  for (const re of patterns) {
    const hit = questions.find((q) => re.test(clean(q.name)) && asText(q.value).trim());
    if (hit) return asText(hit.value).trim();
  }
  return "";
}

/** Fillout echoes prefilled/hidden fields (e.g. ?instructor=Anisha+Shah) here, not in `questions`. */
function findParam(params: { name: string; value: string }[] | undefined, patterns: RegExp[]): string {
  if (!params) return "";
  for (const re of patterns) {
    const hit = params.find((p) => re.test(p.name) && p.value?.trim());
    if (hit) return hit.value.trim();
  }
  return "";
}

function templateFromLevel(level: string, fallback: TrainerTemplate): TrainerTemplate {
  const l = level.toLowerCase();
  if (/cycle/.test(l)) return "powerCycle";
  if (/strength|lab|fit/.test(l)) return "Strength Lab";
  if (/barre|mat|studio/.test(l)) return "Barre";
  return fallback;
}

/** Star / rating style answers → percentage. */
function ratingPercent(questions: ApiQuestion[]): number | null {
  const star = questions.find((q) => q.type === "StarRating" && q.value != null);
  if (!star) return null;
  const n = Number(star.value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n / 5) * 100);
}

export type MappedSubmission = {
  sourceRef: string;
  submissionId: string;
  formId: string;
  formName: string;
  trainer: string;
  template: TrainerTemplate;
  studio: string;
  classType: string;
  evaluator: string;
  classAt: string;
  scorePercent: number;
  band: string;
  scores: ScoreRow[];
  strengths: string[];
  improvements: string[];
  focusPoints: string;
  goals: string;
  comments: string;
  answers: { label: string; value: string }[];
  submittedAt: string;
  source: string;
};

/**
 * Maps a Fillout submission onto the weighted rubric. Handles both the
 * technical assessment forms (❖ NumberInput criteria + calculations) and
 * the member-facing non-technical form (star rating + checkboxes).
 */
export function mapSubmission(
  submission: ApiSubmission,
  form: { embedId: string; template: TrainerTemplate; name: string },
  source = "fillout-api",
): MappedSubmission {
  const questions = submission.questions ?? [];
  const calculations = submission.calculations ?? [];

  const level = findQ(questions, [/^level$/i, /format/i, /programme|program/i]);
  const template = templateFromLevel(level, form.template);
  const rubric = RUBRICS[template];

  // Scored criteria arrive as NumberInput rows, usually prefixed with ❖.
  const numeric = questions.filter(
    (q) => q.type === "NumberInput" && q.value !== null && q.value !== undefined && Number.isFinite(Number(q.value)),
  );

  const scores: ScoreRow[] = [];
  const usedNames = new Set<string>();

  if (numeric.length > 0) {
    // Match each rubric criterion to its closest form question.
    for (const criterion of rubric) {
      const words = criterion.category
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length > 3);
      let best: { q: ApiQuestion; hits: number } | null = null;
      for (const q of numeric) {
        if (usedNames.has(q.id)) continue;
        const label = clean(q.name).toLowerCase();
        const hits = words.filter((w) => label.includes(w)).length;
        if (hits > 0 && (!best || hits > best.hits)) best = { q, hits };
      }
      // Only score criteria the form actually asked about, so a partial
      // submission is not penalised for questions that were never shown.
      if (best) {
        usedNames.add(best.q.id);
        const raw = Number(best.q.value);
        const scaled =
          raw <= 5 && criterion.weightage > 5
            ? Math.round((raw / 5) * criterion.weightage * 10) / 10
            : Math.min(raw, criterion.weightage);
        scores.push({ category: criterion.category, weightage: criterion.weightage, score: scaled });
      }
    }

    // Any remaining ❖ questions become extra criteria so nothing is lost.
    for (const q of numeric) {
      if (usedNames.has(q.id)) continue;
      const raw = Number(q.value);
      if (!Number.isFinite(raw)) continue;
      scores.push({ category: clean(q.name), weightage: Math.max(5, Math.ceil(raw)), score: raw });
    }
  }

  const summary = scores.length > 0 ? summariseScores(scores) : null;

  // Prefer the form's own weighted total when present.
  const totalCalc = calculations.find((c) => /total new|^total$|weighted/i.test(c.name));
  const starPct = ratingPercent(questions);
  const scorePercent =
    totalCalc && totalCalc.value > 0
      ? Math.max(0, Math.min(100, Math.round(totalCalc.value)))
      : starPct ?? summary?.scorePercent ?? 0;

  const answers = questions
    .filter((q) => asText(q.value).trim())
    .map((q) => ({ label: clean(q.name), value: asText(q.value).slice(0, 400) }));

  const classDate = findQ(questions, [/class date/i, /date\s*&?\s*time/i, /^date$/i]);
  const classTime = findQ(questions, [/class time/i, /^time$/i]);

  const strengths = findQ(questions, [/key strengths/i, /what stood out/i, /yes because/i]);
  const improvements = findQ(questions, [/areas for improvement/i, /please specify what/i, /no because/i]);

  return {
    sourceRef: `fillout:${form.embedId}:${submission.submissionId}`,
    submissionId: submission.submissionId,
    formId: form.embedId,
    formName: form.name,
    trainer:
      findQ(questions, [/^trainer name/i, /^trainer$/i, /instructor/i, /faculty/i, /taught by/i, /staff name/i]) ||
      findParam(submission.urlParameters, [/trainer/i, /instructor/i, /faculty/i]) ||
      "Unknown trainer",
    template,
    studio: findQ(questions, [/^center$/i, /^centre$/i, /studio|location/i]),
    classType: level || template,
    evaluator: findQ(questions, [/evaluated by/i, /assessor|reviewer|observer/i]),
    classAt: [classDate, classTime].filter(Boolean).join(" "),
    scorePercent,
    band: performanceBand(scorePercent),
    scores,
    strengths: strengths ? strengths.split(/,\s*(?=[A-Z])|\n/).filter(Boolean).slice(0, 5) : summary?.strengths ?? [],
    improvements: improvements
      ? improvements.split(/,\s*(?=[A-Z])|\n/).filter(Boolean).slice(0, 5)
      : summary?.improvements ?? [],
    focusPoints: findQ(questions, [/immediate coaching/i, /focus/i]),
    goals: findQ(questions, [/goal|target|next step|action plan/i]),
    comments: findQ(questions, [/other remarks/i, /additional comments/i, /comment|remark/i]),
    answers,
    submittedAt: submission.submissionTime ?? new Date().toISOString(),
    source,
  };
}

/* ------------------------------------------------------------------ */
/* Zite (Strength Lab / powerCycle) custom webhook payload              */
/* ------------------------------------------------------------------ */

const ZITE_CRITERIA = [
  { key: "scorePreClass", category: "Pre Class Setup", weightage: 5 },
  { key: "scoreClientConnection", category: "Client Connection", weightage: 20 },
  { key: "scoreUspIntegration", category: "USP Integration", weightage: 10 },
  { key: "scoreMapping", category: "Mapping & Learning Styles", weightage: 10 },
  { key: "scoreMusicalArc", category: "Musical Arc", weightage: 15 },
  { key: "scoreCoachingDelivery", category: "Coaching Delivery", weightage: 15 },
  { key: "scoreMotivation", category: "Motivation", weightage: 15 },
  { key: "scoreTimeManagement", category: "Time Management", weightage: 5 },
  { key: "scorePostClass", category: "Post Class", weightage: 5 },
] as const;

/** Zite posts a bespoke flat schema (trainerName, scorePreClass, ...), not Fillout's question format. */
export function isZitePayload(payload: unknown): payload is Record<string, unknown> {
  const p = payload as Record<string, unknown> | null;
  return !!p && typeof p.trainerName === "string" && typeof p.scorePreClass === "number";
}

export function mapZiteAssessment(payload: Record<string, unknown>): MappedSubmission {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  const scores: ScoreRow[] = ZITE_CRITERIA.map((c) => ({
    category: c.category,
    weightage: c.weightage,
    score: num(payload[c.key]),
  }));
  const summary = summariseScores(scores);
  const scorePercent = typeof payload.totalScore === "number" ? Math.round(payload.totalScore) : summary.scorePercent;
  const sessionName = str(payload.sessionName);
  const template: TrainerTemplate = /cycle/i.test(sessionName) ? "powerCycle" : "Strength Lab";
  const recordId = str(payload.ziteRecordId) || `zite-${Date.now()}`;
  const strengths = str(payload.keyStrengths);
  const improvements = str(payload.areasForImprovement);
  const reportUrl = str(payload.reportUrl);

  return {
    sourceRef: `zite:${recordId}`,
    submissionId: recordId,
    formId: "zite-assessment",
    formName: "Zite trainer assessment",
    trainer: str(payload.trainerName).trim() || "Unknown trainer",
    template,
    studio: str(payload.location),
    classType: sessionName || template,
    evaluator: str(payload.evaluatorName),
    classAt: str(payload.formattedDate) || str(payload.classDate),
    scorePercent,
    band: performanceBand(scorePercent),
    scores,
    strengths: strengths ? strengths.split(/\.\s+|\n/).filter(Boolean).slice(0, 5) : summary.strengths,
    improvements: improvements ? improvements.split(/\.\s+|\n/).filter(Boolean).slice(0, 5) : summary.improvements,
    focusPoints: str(payload.coachingActionPlan),
    goals: str(payload.coachingActionPlan),
    comments: reportUrl ? `Full report: ${reportUrl}` : "",
    answers: Object.entries(payload)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .map(([k, v]) => ({ label: k, value: String(v) })),
    submittedAt: (() => {
      const d = str(payload.classDate);
      const parsed = d ? new Date(d) : null;
      return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
    })(),
    source: "zite-webhook",
  };
}

/** Normalises an inbound webhook body into the API submission shape. */
export function normaliseWebhook(payload: unknown): { formId: string; submission: ApiSubmission } | null {
  const root = (payload ?? {}) as Record<string, unknown>;
  const sub = (root.submission ?? root.data ?? root) as Record<string, unknown>;
  const formId = String(root.formId ?? sub.formId ?? root.form_id ?? "");
  const submissionId = String(sub.submissionId ?? sub.id ?? root.submissionId ?? `wh-${Date.now()}`);

  let questions = (sub.questions ?? root.questions) as ApiQuestion[] | undefined;
  if (!Array.isArray(questions)) {
    // Fall back to a flat key/value object body.
    questions = Object.entries(sub)
      .filter(([, v]) => v !== null && typeof v !== "object")
      .map(([k, v], i) => ({ id: `k${i}`, name: k, type: typeof v === "number" ? "NumberInput" : "ShortAnswer", value: v }));
  }

  return {
    formId,
    submission: {
      submissionId,
      submissionTime: String(sub.submissionTime ?? sub.lastUpdatedAt ?? new Date().toISOString()),
      questions,
      calculations: (sub.calculations ?? []) as ApiCalculation[],
    },
  };
}
