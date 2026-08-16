import type { TrainerTemplate } from "./catalog";

export type Criterion = { category: string; weightage: number };

/** Weighted rubrics mirroring the Athena training-evaluation forms. */
export const RUBRICS: Record<TrainerTemplate, Criterion[]> = {
  Barre: [
    { category: "Client attendance", weightage: 12.5 },
    { category: "Client retention", weightage: 12.5 },
    { category: "Client outreach, communication and connection", weightage: 12.5 },
    { category: "Client feedback", weightage: 12.5 },
    { category: "Mindful moment / USP integration / Motivation", weightage: 8 },
    { category: "Musicality", weightage: 8 },
    { category: "Energy and vocals", weightage: 8 },
    { category: "Choreography and sequencing", weightage: 8 },
    { category: "Learning styles and use of names", weightage: 8 },
    { category: "Classes, workshops, meetings and core values", weightage: 10 },
  ],
  powerCycle: [
    { category: "Class attendance and bike fill rate", weightage: 12.5 },
    { category: "Client retention and repeat riders", weightage: 12.5 },
    { category: "Client outreach, communication and connection", weightage: 12.5 },
    { category: "Client feedback", weightage: 12.5 },
    { category: "Ride motivation / USP integration", weightage: 8 },
    { category: "Musicality and beat matching", weightage: 10 },
    { category: "Energy, vocals and command", weightage: 10 },
    { category: "Ride programming and sequencing", weightage: 8 },
    { category: "Safety, setup and form corrections", weightage: 8 },
    { category: "Work ethics, meetings and core values", weightage: 6 },
  ],
  "Strength Lab": [
    { category: "Pre-class setup", weightage: 8 },
    { category: "Verbal cues", weightage: 8 },
    { category: "Visual demonstrations", weightage: 8 },
    { category: "Injury modifications", weightage: 8 },
    { category: "Level-appropriate personal modifications", weightage: 8 },
    { category: "USP integration, motivation and connection", weightage: 8 },
    { category: "Music choices", weightage: 7 },
    { category: "Studio space and equipment organisation", weightage: 7 },
    { category: "Time management and class flow", weightage: 7 },
    { category: "Use of client names", weightage: 7 },
    { category: "Overall energy", weightage: 8 },
    { category: "Mindful moment", weightage: 8 },
    { category: "Post-class spiel", weightage: 8 },
  ],
  General: [
    { category: "Class delivery and flow", weightage: 20 },
    { category: "Client engagement and connection", weightage: 20 },
    { category: "Technical knowledge and safety", weightage: 20 },
    { category: "Energy, music and atmosphere", weightage: 20 },
    { category: "Professionalism and core values", weightage: 20 },
  ],
};

export type ScoreRow = { category: string; score: number; weightage: number };

export function performanceBand(scorePercent: number): string {
  if (scorePercent < 65) return "High coaching priority";
  if (scorePercent < 80) return "Development watch";
  if (scorePercent < 90) return "On-track performance";
  return "Top performer";
}

export function bandTone(band: string): string {
  if (band.startsWith("High coaching")) return "danger-soft";
  if (band.startsWith("Development")) return "warn-soft";
  if (band.startsWith("Top")) return "mint-soft";
  return "accent-soft";
}

export function summariseScores(scores: ScoreRow[]): {
  scorePercent: number;
  strengths: string[];
  improvements: string[];
} {
  const totalWeight = scores.reduce((s, r) => s + r.weightage, 0) || 1;
  const earned = scores.reduce((s, r) => s + Math.min(r.score, r.weightage), 0);
  const scorePercent = Math.round((earned / totalWeight) * 100);
  const ratios = scores
    .filter((r) => r.weightage > 0)
    .map((r) => ({ ...r, ratio: r.score / r.weightage }))
    .sort((a, b) => b.ratio - a.ratio);
  return {
    scorePercent,
    strengths: ratios
      .filter((r) => r.ratio >= 0.8)
      .slice(0, 4)
      .map((r) => `${r.category} — ${Math.round(r.ratio * 100)}%`),
    improvements: ratios
      .filter((r) => r.ratio < 0.7)
      .slice(-4)
      .map((r) => `${r.category} — ${Math.round(r.ratio * 100)}%`),
  };
}

/* ------------------------------------------------------------------ */
/* Fillout payload mapping                                             */
/* ------------------------------------------------------------------ */

type Pair = { label: string; value: string };

function flatten(input: unknown, pairs: Pair[] = [], path: string[] = []): Pair[] {
  if (input === null || input === undefined) return pairs;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const label = String(rec.name ?? rec.label ?? rec.question ?? rec.title ?? path.at(-1) ?? "");
        const raw = rec.value ?? rec.answer ?? rec.text ?? rec.response;
        if (label && raw !== undefined && raw !== null && typeof raw !== "object") {
          pairs.push({ label, value: String(raw) });
        } else {
          flatten(item, pairs, path);
        }
      }
    }
    return pairs;
  }
  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object") flatten(value, pairs, [...path, key]);
      else pairs.push({ label: key, value: String(value) });
    }
  }
  return pairs;
}

function find(pairs: Pair[], patterns: RegExp[]): string {
  for (const re of patterns) {
    const hit = pairs.find((p) => re.test(p.label));
    if (hit?.value?.trim()) return hit.value.trim();
  }
  return "";
}

function parseNumber(value: string): number {
  const m = value.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreFor(criterion: Criterion, pairs: Pair[]): number {
  const target = slug(criterion.category);
  const words = target.split(" ").filter((w) => w.length > 3);
  let best: { pair: Pair; hits: number } | null = null;
  for (const pair of pairs) {
    const label = slug(pair.label);
    if (!/\d/.test(pair.value)) continue;
    const hits = words.filter((w) => label.includes(w)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { pair, hits };
  }
  if (!best) return 0;
  const raw = parseNumber(best.pair.value);
  // Values may arrive on a 0-5, 0-10 or already-weighted scale.
  if (raw <= 5 && criterion.weightage > 5) return Math.round((raw / 5) * criterion.weightage * 10) / 10;
  if (raw <= 10 && criterion.weightage > 10) return Math.round((raw / 10) * criterion.weightage * 10) / 10;
  return Math.min(raw, criterion.weightage);
}

export type FilloutMapping = {
  sourceRef: string;
  submissionId: string;
  formId: string;
  receivedAt: string;
  trainer: string;
  template: TrainerTemplate;
  studio: string;
  classType: string;
  evaluator: string;
  focusPoints: string;
  goals: string;
  comments: string;
  scores: ScoreRow[];
  scorePercent: number;
  band: string;
  strengths: string[];
  improvements: string[];
  answers: Pair[];
  submittedAt: string;
};

export function mapFilloutSubmission(payload: unknown): FilloutMapping {
  const root = (payload ?? {}) as Record<string, unknown>;
  const submission = (root.submission ?? root.data ?? root) as Record<string, unknown>;
  const answers = flatten(submission).filter(
    (p) => p.label && p.value && p.value.length < 400 && !/^https?:/.test(p.label),
  );

  const submissionId = String(
    submission.submissionId ?? submission.id ?? root.submissionId ?? root.id ?? `sub-${Date.now()}`,
  );
  const formId = String(root.formId ?? submission.formId ?? "training-evaluation");

  const urlParams = ((root.urlParameters ?? submission.urlParameters) as { name?: string; value?: string }[] | undefined) ?? [];
  const trainer =
    find(answers, [/trainer/i, /instructor/i, /coach/i, /teacher/i, /name of/i, /faculty/i, /taught by/i]) ||
    find(
      urlParams.map((p) => ({ label: p.name ?? "", value: p.value ?? "" })),
      [/trainer/i, /instructor/i, /faculty/i],
    ) ||
    "Unknown trainer";
  const rawTemplate = find(answers, [/template/i, /format/i, /programme|program/i, /class type/i]);
  const template: TrainerTemplate = /cycle/i.test(rawTemplate)
    ? "powerCycle"
    : /strength/i.test(rawTemplate)
      ? "Strength Lab"
      : /barre/i.test(rawTemplate)
        ? "Barre"
        : "General";

  const rubric = RUBRICS[template];
  const scores: ScoreRow[] = rubric.map((c) => ({
    category: c.category,
    weightage: c.weightage,
    score: scoreFor(c, answers),
  }));
  const { scorePercent, strengths, improvements } = summariseScores(scores);
  const submittedAt =
    find(answers, [/submitted|submission date|createdAt|lastUpdatedAt/i]) || new Date().toISOString();

  return {
    sourceRef: `fillout:${formId}:${submissionId}`,
    submissionId,
    formId,
    receivedAt: new Date().toISOString(),
    trainer,
    template,
    studio: find(answers, [/studio|location|centre|center/i]),
    classType: find(answers, [/class type|class format|session type/i]) || template,
    evaluator: find(answers, [/evaluator|reviewed by|assessor|manager|observer/i]),
    focusPoints: find(answers, [/focus|priority area|area of focus/i]),
    goals: find(answers, [/goal|target|next step|action plan/i]),
    comments: find(answers, [/comment|note|remark|feedback|observation/i]),
    scores,
    scorePercent,
    band: performanceBand(scorePercent),
    strengths,
    improvements,
    answers,
    submittedAt: Number.isNaN(Date.parse(submittedAt)) ? new Date().toISOString() : new Date(submittedAt).toISOString(),
  };
}
