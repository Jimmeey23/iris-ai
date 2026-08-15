"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FilloutEmbed from "./FilloutEmbed";
import FilloutSync from "./FilloutSync";
import { EmptyState, Panel, timeAgo } from "./ui";
import { bandTone } from "@/lib/trainer-eval";
import type { EmbedKind } from "@/lib/fillout";
import { apiFetch } from "@/lib/api-client";

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

type Evaluation = {
  id: number;
  trainerId: number | null;
  trainerName: string;
  template: string;
  scorePercent: number;
  band: string;
  studio: string;
  evaluator: string;
  submittedAt: string;
  source: string;
};

export default function FilloutForms({
  forms,
  recent,
  configured,
  lastSync,
}: {
  forms: FormDef[];
  recent: Evaluation[];
  configured: boolean;
  lastSync: string | null;
}) {
  const router = useRouter();
  const [active, setActive] = useState<FormDef>(forms[0]);
  const [rows, setRows] = useState<Evaluation[]>(recent);
  const [listening, setListening] = useState(true);
  const [ping, setPing] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(lastSync);
  const [pulling, setPulling] = useState(false);
  const seen = useRef(new Set(recent.map((r) => r.id)));

  /** Pull new submissions straight from the Fillout API, then refresh the list. */
  const poll = useCallback(
    async (viaApi: boolean) => {
      try {
        if (viaApi && configured) {
          const s = await apiFetch<{ lastSync?: string }>("/api/fillout?action=sync");
          if (s?.lastSync) setSyncedAt(s.lastSync);
        }
        const d = await apiFetch<{ evaluations?: Evaluation[]; lastSync?: string | null }>("/api/fillout?action=list");
        const list = d.evaluations ?? [];
        if (d.lastSync) setSyncedAt(d.lastSync);
        const fresh = list.filter((r) => !seen.current.has(r.id));
        setRows(list);
        if (fresh.length > 0) {
          fresh.forEach((r) => seen.current.add(r.id));
          setPing(`${fresh.length} new submission${fresh.length > 1 ? "s" : ""} · ${fresh[0].trainerName} scored ${fresh[0].scorePercent}%`);
          router.refresh();
          setTimeout(() => setPing(null), 7000);
        }
      } catch {
        /* best effort */
      }
    },
    [configured, router],
  );

  useEffect(() => {
    if (!listening) return;
    const id = setInterval(() => void poll(true), 20000);
    return () => clearInterval(id);
  }, [listening, poll]);

  /** Fillout posts a message from inside the iframe when a form is completed. */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; eventType?: string } | string;
      const type = typeof data === "string" ? data : data?.type ?? data?.eventType;
      if (typeof type === "string" && /fillout|zite|submit|submission|complete/i.test(type)) {
        setPing("Submission received — syncing…");
        setTimeout(() => void poll(true), 2500);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [poll]);

  const manualSync = async () => {
    setPulling(true);
    try {
      const d = await apiFetch<{
        ok?: boolean;
        imported?: number;
        updated?: number;
        error?: string;
      }>("/api/fillout?action=historic");
      setPing(d.ok ? `Imported ${d.imported}, refreshed ${d.updated}.` : d.error ?? "Sync failed.");
      await poll(false);
      setTimeout(() => setPing(null), 7000);
    } finally {
      setPulling(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {forms.map((f) => (
            <button key={f.key} className="pill-tab" data-active={active.key === f.key} onClick={() => setActive(f)}>
              <span className="mr-1 opacity-70">{f.icon}</span>
              {f.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span
            className="chip"
            style={{
              background: configured ? "var(--mint-soft)" : "var(--warn-soft)",
              color: configured ? "var(--mint)" : "var(--warn)",
            }}
            title={configured ? "Fillout API token detected" : "No Fillout API token"}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${configured ? "live-dot" : ""}`} style={{ background: configured ? "var(--mint)" : "var(--warn)" }} />
            {configured ? "API connected" : "Token missing"}
          </span>
          <button
            onClick={() => setListening((v) => !v)}
            className="chip"
            style={{
              background: listening ? "var(--accent-soft)" : "var(--surface-3)",
              color: listening ? "var(--accent)" : "var(--text-3)",
            }}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${listening ? "live-dot" : ""}`} style={{ background: listening ? "var(--accent)" : "var(--text-3)" }} />
            {listening ? "Listening" : "Paused"}
          </button>
          <button onClick={manualSync} disabled={pulling} className="btn btn-ghost !py-1.5 disabled:opacity-50">
            {pulling ? "Syncing…" : "Sync now"}
          </button>
          <FilloutSync />
        </div>
      </div>

      {ping && (
        <div className="animate-pop rounded-2xl px-4 py-2.5 text-[12px] font-medium accent-soft">✦ {ping}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
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
            <FilloutEmbed
              key={active.embedId}
              embedId={active.embedId}
              kind={active.embedKind}
              height={active.height}
            />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Inbound submissions"
            subtitle={syncedAt ? `Last synced ${timeAgo(syncedAt)} ago` : `${rows.length} recorded`}
            padded={false}
          >
            {rows.length === 0 ? (
              <EmptyState icon="◔" title="Nothing yet" body="Submissions appear here the moment a form is completed." />
            ) : (
              <div className="hide-scrollbar max-h-[520px] divide-y overflow-y-auto hairline">
                {rows.slice(0, 40).map((r, i) => (
                  <a
                    key={r.id}
                    href={r.trainerId ? `/trainers/${r.trainerId}` : "/trainers"}
                    className="animate-rise row-reveal flex items-center gap-3 px-4 py-2.5 transition hover:bg-[var(--surface-3)]"
                    style={{ animationDelay: `${Math.min(i, 10) * 26}ms` }}
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold tabular"
                      style={{
                        background: "var(--surface-3)",
                        color: r.scorePercent >= 80 ? "var(--mint)" : r.scorePercent >= 65 ? "var(--accent)" : "var(--danger)",
                      }}
                    >
                      {r.scorePercent}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium txt">{r.trainerName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        <span className={`chip ${bandTone(r.band)} !text-[9px]`}>{r.band}</span>
                        <span className="chip chip-line !text-[9px]">{r.template}</span>
                        {r.evaluator && <span className="text-[9.5px] txt-3">by {r.evaluator}</span>}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] txt-3" suppressHydrationWarning>
                      {timeAgo(r.submittedAt)}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="How it flows" subtitle="Form to trainer profile">
            <ol className="space-y-2.5">
              {[
                ["Submit", "A form is completed here or on the public Fillout link."],
                ["Capture", "The webhook posts to /api/fillout; the poller also pulls the API every 20 seconds."],
                ["Score", "Answers map onto the weighted rubric for that format, using the form's own total when present."],
                ["Profile", "The trainer record is created or updated, and low scores raise a coaching alert."],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold accent-soft">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-[11.5px] font-semibold txt">{t}</span>
                    <span className="block text-[11px] leading-relaxed txt-3">{b}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-3 rounded-xl px-3 py-2 text-[10.5px] leading-relaxed txt-3" style={{ background: "var(--surface-3)" }}>
              Webhook endpoint: <code className="accent-txt">/api/fillout</code> — the two Zite forms deliver only by
              webhook, the two Fillout forms are also polled from the API.
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
