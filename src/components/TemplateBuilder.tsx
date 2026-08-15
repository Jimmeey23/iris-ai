"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_META, TAXONOMY } from "@/lib/taxonomy";
import { TEMPLATE_GROUPS } from "@/lib/templates";
import { useEscape, useScrollLock } from "@/lib/use-escape";
import { useUser } from "./Providers";
import { apiPost, ApiError } from "@/lib/api-client";

type Field = {
  kind: string;
  label: string;
  name: string;
  options?: string[];
  placeholder?: string;
  required?: boolean;
};

const FIELD_KINDS = [
  { id: "text", label: "Short text" },
  { id: "textarea", label: "Long text" },
  { id: "select", label: "Dropdown" },
  { id: "multiselect", label: "Multi-select" },
  { id: "number", label: "Number" },
  { id: "time", label: "Time" },
  { id: "date", label: "Date" },
  { id: "boolean", label: "Yes/No" },
  { id: "rating", label: "Rating 1–5" },
  { id: "member", label: "Momence member" },
  { id: "session", label: "Momence class" },
  { id: "private-session", label: "Momence hosted class" },
  { id: "trainer", label: "Momence trainer" },
  { id: "studio", label: "Studio" },
  { id: "membership", label: "Membership package" },
];

const ICONS = ["▤", "◈", "◇", "◍", "◑", "◒", "◷", "◫", "◎", "◨", "◧", "◊", "◉", "✎", "⬡"];

/** Pulls the id out of a pasted Fillout / Zite embed snippet. */
function parseEmbed(raw: string): { id: string; kind: "fillout-v1" | "zite-v2"; height?: number } | null {
  const zite = raw.match(/data-zite-id=["']([^"']+)["']/);
  if (zite) {
    const h = raw.match(/height:\s*(\d+)px/);
    return { id: zite[1], kind: "zite-v2", height: h ? Number(h[1]) : 700 };
  }
  const fill = raw.match(/data-fillout-id=["']([^"']+)["']/);
  if (fill) {
    const h = raw.match(/height:\s*(\d+)px/);
    return { id: fill[1], kind: "fillout-v1", height: h ? Number(h[1]) : 500 };
  }
  const bare = raw.trim();
  if (/^[A-Za-z0-9_-]{6,40}$/.test(bare)) {
    return { id: bare, kind: /[A-Z]/.test(bare) ? "fillout-v1" : "zite-v2", height: 600 };
  }
  return null;
}

export default function TemplateBuilder({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"form" | "embed">("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [icon, setIcon] = useState("▤");
  const [group, setGroup] = useState<string>("Facilities");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subcategory, setSubcategory] = useState(TAXONOMY[CATEGORIES[0]][0]);
  const [priority, setPriority] = useState("Medium");
  const [snippet, setSnippet] = useState("");
  const [fields, setFields] = useState<Field[]>([
    { kind: "textarea", label: "What happened", name: "extra", required: true },
  ]);

  useEscape(open, () => setOpen(false));
  useScrollLock(open);

  const embed = useMemo(() => (snippet.trim() ? parseEmbed(snippet) : null), [snippet]);
  const subs = TAXONOMY[category] ?? [];

  const reset = () => {
    setName(""); setBlurb(""); setIcon("▤"); setSnippet(""); setError(null);
    setFields([{ kind: "textarea", label: "What happened", name: "extra", required: true }]);
  };

  const addField = () =>
    setFields((f) => [...f, { kind: "text", label: "", name: `field_${f.length + 1}`, required: false }]);

  const patchField = (i: number, patch: Partial<Field>) =>
    setFields((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await apiPost<{ ok?: boolean; error?: string }>("/api/templates", {
        name, blurb, icon, group, category, subcategory, priority, kind,
        embedId: embed?.id,
        embedKind: embed?.kind,
        embedHeight: embed?.height,
        fields: kind === "form" ? fields.filter((f) => f.label.trim()) : [],
        createdBy: user.name,
      });
      if (d.ok) {
        setOpen(false);
        reset();
        onCreated?.();
        router.refresh();
      } else setError(d.error ?? "Could not save the template.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary">+ New template</button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <button className="absolute inset-0 backdrop-blur-sm"
            style={{ background: "color-mix(in srgb, var(--page) 68%, transparent)" }}
            onClick={() => setOpen(false)} aria-label="Close" />
          <div className="panel animate-slide-up relative z-10 flex max-h-[94vh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl">
            <div className="flex items-center gap-2.5 border-b px-5 py-3.5 hairline" style={{ background: "var(--surface-2)" }}>
              <span className="flex h-8 w-8 items-center justify-center rounded-xl text-[14px] accent-soft">{icon}</span>
              <div className="min-w-0 flex-1">
                <div className="serif text-[20px] leading-none txt">New template</div>
                <div className="mt-1 text-[9px] uppercase tracking-[0.18em] txt-3">Build a form or embed a Fillout survey</div>
              </div>
              <button onClick={() => setOpen(false)} className="btn btn-ghost !px-2 !py-1">×</button>
            </div>

            <div className="hide-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="seg">
                <button data-active={kind === "form"} onClick={() => setKind("form")}>Structured form</button>
                <button data-active={kind === "embed"} onClick={() => setKind("embed")}>Fillout embed</button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Template name *</label>
                  <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Locker room deep clean" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Group</label>
                  <select className="field" value={group} onChange={(e) => setGroup(e.target.value)}>
                    {TEMPLATE_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium txt-2">Description</label>
                  <input className="field" value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="One line describing when to use it" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Category</label>
                  <select className="field" value={category}
                    onChange={(e) => { setCategory(e.target.value); setSubcategory(TAXONOMY[e.target.value][0]); }}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].icon} {c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Subcategory</label>
                  <select className="field" value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
                    {subs.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Default priority</label>
                  <select className="field" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {["Critical", "High", "Medium", "Low"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Icon</label>
                  <div className="flex flex-wrap gap-1">
                    {ICONS.map((i) => (
                      <button key={i} onClick={() => setIcon(i)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px] transition"
                        style={{ background: icon === i ? "var(--accent)" : "var(--surface-3)", color: icon === i ? "#fff" : "var(--text-2)" }}>
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {kind === "embed" ? (
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Fillout embed snippet or ID *</label>
                  <textarea rows={4} className="field resize-none" style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px" }}
                    value={snippet} onChange={(e) => setSnippet(e.target.value)}
                    placeholder={`<div style="width:100%;height:700px;" data-zite-id="abc123" ...></div><script src="https://server.fillout.com/embed/v2-zite/"></script>`} />
                  {embed ? (
                    <div className="mt-2 rounded-xl px-3 py-2 text-[11.5px] mint-soft">
                      ✓ Detected <strong>{embed.kind === "zite-v2" ? "Zite v2" : "Fillout v1"}</strong> form
                      <code className="ml-1 accent-txt">{embed.id}</code> at {embed.height}px.
                      Submissions post to <code>/api/fillout</code>.
                    </div>
                  ) : snippet.trim() ? (
                    <div className="mt-2 rounded-xl px-3 py-2 text-[11.5px] danger-soft">
                      Could not find a <code>data-fillout-id</code> or <code>data-zite-id</code> in that snippet.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.18em] txt-3">Fields</span>
                    <button onClick={addField} className="btn btn-ghost ml-auto !py-1 !text-[11px]">+ Add field</button>
                  </div>
                  <div className="space-y-2">
                    {fields.map((f, i) => (
                      <div key={i} className="rounded-2xl p-2.5" style={{ background: "var(--surface-3)" }}>
                        <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                          <input className="field !py-1.5 !text-[12px]" placeholder="Field label"
                            value={f.label}
                            onChange={(e) => patchField(i, { label: e.target.value, name: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30) || `field_${i}` })} />
                          <select className="field !py-1.5 !text-[12px]" value={f.kind} onChange={(e) => patchField(i, { kind: e.target.value })}>
                            {FIELD_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                          </select>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => patchField(i, { required: !f.required })}
                              className="chip !px-2"
                              style={{ background: f.required ? "var(--accent-soft)" : "var(--surface)", color: f.required ? "var(--accent)" : "var(--text-3)" }}>
                              {f.required ? "required" : "optional"}
                            </button>
                            <button onClick={() => setFields((x) => x.filter((_, j) => j !== i))}
                              className="btn btn-ghost !px-2 !py-1 !text-[12px]" style={{ color: "var(--danger)" }}>×</button>
                          </div>
                        </div>
                        {(f.kind === "select" || f.kind === "multiselect") && (
                          <input className="field mt-2 !py-1.5 !text-[11.5px]" placeholder="Options, comma separated"
                            value={(f.options ?? []).join(", ")}
                            onChange={(e) => patchField(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="rounded-xl px-3 py-2 text-[11.5px] danger-soft">{error}</p>}
            </div>

            <div className="flex items-center gap-2 border-t px-5 py-3 hairline" style={{ background: "var(--surface-2)" }}>
              <span className="text-[10px] txt-3">
                {kind === "embed" ? "Embedded forms feed trainer profiles automatically" : "AI sets severity and SLA on submit"}
              </span>
              <button onClick={() => setOpen(false)} className="btn btn-ghost ml-auto">Cancel</button>
              <button onClick={submit} disabled={busy || !name.trim()} className="btn btn-primary disabled:opacity-50">
                {busy ? "Saving…" : "Create template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
