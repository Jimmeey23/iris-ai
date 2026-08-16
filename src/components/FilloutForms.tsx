"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import FilloutEmbed from "./FilloutEmbed";
import { Panel } from "./ui";
import type { EmbedKind } from "@/lib/fillout";
import { TRAINER_TEMPLATES, type TrainerTemplate } from "@/lib/catalog";
import { apiPost, ApiError } from "@/lib/api-client";

export type FormDef = {
  key: string;
  name: string;
  blurb: string;
  template: string;
  embedId: string;
  embedKind: EmbedKind;
  height: number;
  icon: string;
  apiPollable: boolean;
};

function AddFormModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<TrainerTemplate>("General");
  const [blurb, setBlurb] = useState("");
  const [embedCode, setEmbedCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setError("Name is required.");
    if (!embedCode.trim()) return setError("Paste the form's embed code or id.");
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/forms", { name, template, blurb, embedCode });
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add form.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: "color-mix(in srgb, var(--page) 68%, transparent)" }}
        onClick={onClose}
        aria-label="Close"
      />
      <div
        className="animate-pop relative z-10 w-full max-w-[520px] overflow-hidden rounded-t-2xl border sm:rounded-2xl hairline"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center gap-2 border-b px-5 py-3.5 hairline" style={{ background: "var(--surface-2)" }}>
          <span className="text-[14px] font-semibold txt">Add a form</span>
          <button onClick={onClose} className="btn btn-ghost ml-auto !px-2 !py-1">×</button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium txt-2">Name *</label>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Yoga assessment" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium txt-2">Rubric</label>
              <select className="field" value={template} onChange={(e) => setTemplate(e.target.value as TrainerTemplate)}>
                {TRAINER_TEMPLATES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium txt-2">Blurb</label>
              <input className="field" value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="Optional description" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium txt-2">Embed code or form id *</label>
            <textarea
              rows={4}
              className="field resize-none font-mono !text-[11px]"
              value={embedCode}
              onChange={(e) => setEmbedCode(e.target.value)}
              placeholder='Paste the Fillout/Zite embed snippet, e.g. <div data-fillout-id="abc123">…</div>, or just the form id.'
            />
          </div>
          {error && <p className="text-[11.5px] font-medium" style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
        <div className="flex items-center gap-2 border-t px-5 py-3 hairline" style={{ background: "var(--surface-2)" }}>
          <span className="text-[10.5px] txt-3">The form id/kind is parsed from the pasted code automatically</span>
          <button onClick={onClose} className="btn btn-ghost ml-auto">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn btn-primary disabled:opacity-50">
            {busy ? "Adding…" : "Add form"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FilloutForms({ forms }: { forms: FormDef[] }) {
  const router = useRouter();
  const [active, setActive] = useState<FormDef | null>(forms[0] ?? null);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {forms.map((f) => (
          <button
            key={f.key}
            onClick={() => setActive(f)}
            className="card-hover animate-rise rounded-2xl p-4 text-left transition"
            style={{
              background: active?.key === f.key ? "var(--accent-soft)" : "var(--surface-2)",
              boxShadow: active?.key === f.key ? "inset 0 0 0 1px var(--accent-line)" : "inset 0 0 0 1px var(--line)",
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[16px]" style={{ background: "var(--surface-3)" }}>
                {f.icon}
              </span>
              <span
                className="chip"
                style={{
                  background: f.apiPollable ? "var(--mint-soft)" : "var(--surface-3)",
                  color: f.apiPollable ? "var(--mint)" : "var(--text-3)",
                }}
              >
                {f.apiPollable ? "API + webhook" : "Webhook"}
              </span>
            </div>
            <div className="serif mt-3 text-[16px] leading-snug txt">{f.name}</div>
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed txt-3">{f.blurb}</p>
            <span className="chip chip-line mt-3">{f.template}</span>
          </button>
        ))}

        <button
          onClick={() => setAddOpen(true)}
          className="card-hover flex flex-col items-center justify-center gap-2 rounded-2xl p-4 text-center transition"
          style={{ boxShadow: "inset 0 0 0 1px dashed var(--line)", border: "1px dashed var(--line)" }}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl text-[18px] accent-soft">+</span>
          <span className="text-[12.5px] font-medium txt-2">Add form</span>
          <span className="text-[10.5px] txt-3">Paste an embed code</span>
        </button>
      </div>

      {active && (
        <Panel
          title={active.name}
          subtitle={active.blurb}
          padded={false}
          action={
            <div className="flex items-center gap-1.5">
              <span className="chip chip-line">{active.template}</span>
              <span
                className="chip"
                style={{
                  background: active.apiPollable ? "var(--mint-soft)" : "var(--surface-3)",
                  color: active.apiPollable ? "var(--mint)" : "var(--text-3)",
                }}
                title={active.apiPollable ? "Polled from the Fillout API" : "Delivered by webhook only"}
              >
                {active.apiPollable ? "API + webhook" : "Webhook"}
              </span>
            </div>
          }
        >
          <div className="overflow-hidden rounded-b-2xl">
            <FilloutEmbed key={active.embedId} embedId={active.embedId} kind={active.embedKind} height={active.height} />
          </div>
        </Panel>
      )}

      {addOpen && (
        <AddFormModal
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
