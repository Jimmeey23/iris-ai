"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RUBRICS } from "@/lib/trainer-eval";
import { TRAINER_TEMPLATES, type TrainerTemplate } from "@/lib/catalog";
import { useEscape, useScrollLock } from "@/lib/use-escape";
import { apiFetch, apiPost, ApiError } from "@/lib/api-client";

/** Embedded evaluation form + remote Fillout sync controls. */
export default function FilloutSync() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [template, setTemplate] = useState<TrainerTemplate>("Barre");
  const [trainer, setTrainer] = useState("");
  const [studio, setStudio] = useState("");
  const [evaluator, setEvaluator] = useState("");
  const [focus, setFocus] = useState("");
  const [goals, setGoals] = useState("");
  const [comments, setComments] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});

  useEscape(open, () => setOpen(false));
  useScrollLock(open);

  const criteria = RUBRICS[template];

  const submit = async () => {
    if (!trainer.trim()) {
      setMsg({ text: "Trainer name is required.", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    const answers = [
      { name: "Trainer name", value: trainer },
      { name: "Template / format", value: template },
      { name: "Studio", value: studio },
      { name: "Evaluator", value: evaluator },
      { name: "Focus points", value: focus },
      { name: "Goals", value: goals },
      { name: "Comments", value: comments },
      ...criteria.map((c) => ({ name: c.category, value: String(scores[c.category] ?? 0) })),
    ];
    try {
      const data = await apiPost<{ ok?: boolean; scorePercent?: number; band?: string; error?: string }>(
        "/api/fillout",
        {
          formId: "embedded-training-evaluation",
          submission: { submissionId: `local-${Date.now()}`, questions: answers },
        },
      );
      if (data.ok) {
        setMsg({ text: `Recorded — ${data.scorePercent}% (${data.band}).`, ok: true });
        setScores({});
        router.refresh();
      } else setMsg({ text: data.error ?? "Could not save.", ok: false });
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : "Network error.", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const pull = async (action: "historic" | "single") => {
    setBusy(true);
    setMsg(null);
    try {
      const data = await apiFetch<{ ok?: boolean; imported?: number; error?: string }>(`/api/fillout?action=${action}`);
      setMsg(
        data.ok
          ? { text: `Imported ${data.imported} submission(s).`, ok: true }
          : { text: data.error ?? "Sync failed.", ok: false },
      );
      if (data.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => void pull("historic")} disabled={busy} className="btn btn-ghost">
        Sync Fillout
      </button>
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        New evaluation
      </button>
      {msg && (
        <span className="text-[11.5px] font-medium" style={{ color: msg.ok ? "var(--mint)" : "var(--danger)" }}>
          {msg.text}
        </span>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <button
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: "color-mix(in srgb, var(--page) 68%, transparent)" }}
            onClick={() => setOpen(false)}
            aria-label="Close"
          />
          <div
            className="animate-pop relative z-10 flex max-h-[92vh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-2xl border sm:rounded-2xl hairline"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}
          >
            <div className="flex items-center gap-2 border-b px-5 py-3.5 hairline" style={{ background: "var(--surface-2)" }}>
              <span className="text-[14px] font-semibold txt">Training evaluation</span>
              <span className="chip accent-soft">{template} rubric</span>
              <button onClick={() => setOpen(false)} className="btn btn-ghost ml-auto !px-2 !py-1">
                ×
              </button>
            </div>

            <div className="hide-scrollbar flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Trainer *</label>
                  <input className="field" value={trainer} onChange={(e) => setTrainer(e.target.value)} placeholder="Full name" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Format</label>
                  <select className="field" value={template} onChange={(e) => setTemplate(e.target.value as TrainerTemplate)}>
                    {TRAINER_TEMPLATES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Studio</label>
                  <input className="field" value={studio} onChange={(e) => setStudio(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Evaluator</label>
                  <input className="field" value={evaluator} onChange={(e) => setEvaluator(e.target.value)} />
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.13em] txt-3">
                  Weighted criteria — score 0 to 5
                </div>
                <div className="space-y-2">
                  {criteria.map((c) => {
                    const v = scores[c.category] ?? 0;
                    return (
                      <div key={c.category} className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-[11.5px] txt-2">
                          {c.category} <span className="txt-3">({c.weightage})</span>
                        </span>
                        <div className="flex gap-1">
                          {[0, 1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              onClick={() => setScores((s) => ({ ...s, [c.category]: n }))}
                              className="h-6 w-6 rounded-md text-[10.5px] font-semibold transition"
                              style={{
                                background: v === n ? "var(--accent)" : "var(--surface-3)",
                                color: v === n ? "#fff" : "var(--text-3)",
                              }}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {[
                { l: "Focus points", v: focus, set: setFocus },
                { l: "Agreed goals", v: goals, set: setGoals },
                { l: "Comments", v: comments, set: setComments },
              ].map((f) => (
                <div key={f.l}>
                  <label className="mb-1 block text-[11px] font-medium txt-2">{f.l}</label>
                  <textarea rows={2} className="field resize-none" value={f.v} onChange={(e) => f.set(e.target.value)} />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 border-t px-5 py-3 hairline" style={{ background: "var(--surface-2)" }}>
              <span className="text-[10.5px] txt-3">Scores are weighted and written straight to the trainer profile</span>
              <button onClick={() => setOpen(false)} className="btn btn-ghost ml-auto">
                Cancel
              </button>
              <button onClick={submit} disabled={busy} className="btn btn-primary disabled:opacity-50">
                {busy ? "Saving…" : "Submit evaluation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
