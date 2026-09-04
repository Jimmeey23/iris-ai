"use client";

import { useCallback, useMemo, useState } from "react";
import { Panel } from "./ui";
import { CATEGORY_DEPARTMENT } from "@/lib/org";
import { basePolicy } from "@/lib/sla";
import { CATEGORIES } from "@/lib/taxonomy";
import { apiFetch, apiPost } from "@/lib/api-client";

type Initial = Record<string, string>;
type Status = Record<string, { configured: boolean; enabled: boolean }>;

const MODELS = [
  { id: "gpt-4.1", label: "GPT-4.1 — recommended for intake" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "o4-mini", label: "o4-mini — deep analysis" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini — cheaper, weaker judgement" },
  { id: "gpt-4o-mini", label: "GPT-4o mini — cheapest" },
];

const TABS = [
  "AI engine", "Momence", "Fillout", "Supabase", "Mailtrap", "n8n", "respond.io", "SLA policy", "Workspace",
] as const;
type Tab = (typeof TABS)[number];

function Field({
  label, value, onChange, type = "text", placeholder, hint, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; hint?: string; mono?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium txt-2">{label}</label>
      <input
        className="field"
        style={mono ? { fontFamily: "ui-monospace, monospace", fontSize: "11.5px" } : undefined}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {hint && <p className="mt-1 text-[10.5px] leading-relaxed txt-3">{hint}</p>}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-[var(--surface-3)]">
      <span className="mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition"
        style={{ background: checked ? "var(--accent)" : "var(--surface-3)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
        <span className="h-4 w-4 rounded-full bg-white transition-transform"
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)", boxShadow: "var(--shadow-sm)" }} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium txt">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-relaxed txt-3">{hint}</span>}
      </span>
    </button>
  );
}

function StatusDot({ state }: { state?: { configured: boolean; enabled: boolean } }) {
  const color = !state?.configured ? "var(--text-3)" : state.enabled ? "var(--mint)" : "var(--warn)";
  const label = !state?.configured ? "Not set up" : state.enabled ? "Live" : "Paused";
  return (
    <span className="chip" style={{ background: "var(--surface-3)", color }}>
      <span className={`h-1.5 w-1.5 rounded-full ${state?.configured && state.enabled ? "live-dot" : ""}`} style={{ background: color }} />
      {label}
    </span>
  );
}

export default function SettingsPanel({
  initial, momenceConnected, momenceHostId, status,
}: {
  initial: Initial;
  momenceConnected: boolean;
  momenceHostId: number | null;
  status: Status;
}) {
  const [tab, setTab] = useState<Tab>("AI engine");
  const [form, setForm] = useState<Initial>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [connected, setConnected] = useState(momenceConnected);
  const [testTo, setTestTo] = useState("");
  const [live, setLive] = useState<Status>(status);

  const set = useCallback((k: string, v: string) => setForm((f) => ({ ...f, [k]: v })), []);
  const bool = (k: string, fallback = false) => (form[k] !== undefined ? form[k] !== "false" && form[k] !== "" : fallback);

  const flash = (text: string, ok: boolean) => {
    setMessage({ text, ok });
    setTimeout(() => setMessage(null), 6000);
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await apiPost<{ momence?: { connected: boolean } }>("/api/settings", form);
      setConnected(!!data.momence?.connected);
      const st = await apiFetch<Status>("/api/integrations");
      setLive(st);
      flash("Settings saved.", true);
    } catch {
      flash("Could not save settings.", false);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (action: string, to?: string) => {
    setSaving(true);
    try {
      const d = await apiPost<{ ok?: boolean; detail?: string }>("/api/integrations", { action, to });
      flash(d.detail ?? (d.ok ? "Test passed." : "Test failed."), !!d.ok);
    } catch {
      flash("Test request failed.", false);
    } finally {
      setSaving(false);
    }
  };

  const slaOverrides = useMemo<Record<string, { respond?: number; resolve?: number }>>(() => {
    try {
      return form.sla_overrides ? JSON.parse(form.sla_overrides) : {};
    } catch {
      return {};
    }
  }, [form.sla_overrides]);

  const setSlaOverride = useCallback(
    (category: string, patch: { respond?: number; resolve?: number }) => {
      setForm((f) => {
        const current = (() => {
          try {
            return f.sla_overrides ? JSON.parse(f.sla_overrides) : {};
          } catch {
            return {};
          }
        })();
        const next = { ...current, [category]: { ...current[category], ...patch } };
        return { ...f, sla_overrides: JSON.stringify(next) };
      });
    },
    [],
  );

  const clearSlaOverride = useCallback((category: string) => {
    setForm((f) => {
      const current = (() => {
        try {
          return f.sla_overrides ? JSON.parse(f.sla_overrides) : {};
        } catch {
          return {};
        }
      })();
      const next = { ...current };
      delete next[category];
      return { ...f, sla_overrides: JSON.stringify(next) };
    });
  }, []);

  const slaRows = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        category: c,
        department: CATEGORY_DEPARTMENT[c] ?? "Operations",
        ...basePolicy(c, "", slaOverrides),
        overridden: !!slaOverrides[c],
      })),
    [slaOverrides],
  );

  const tabStatus: Partial<Record<Tab, keyof Status>> = {
    "AI engine": "openai", Momence: "momence", Fillout: "fillout",
    Supabase: "supabase", Mailtrap: "mailtrap", n8n: "n8n", "respond.io": "respondio",
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[218px_minmax(0,1fr)]">
      <aside className="panel h-fit rounded-2xl p-2">
        {TABS.map((t) => {
          const key = tabStatus[t];
          const st = key ? live[key] : undefined;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition hover:bg-[var(--surface-3)]"
              style={tab === t ? { background: "var(--accent-soft)" } : undefined}
            >
              <span className="flex-1 truncate text-[12.5px] font-medium" style={{ color: tab === t ? "var(--accent)" : "var(--text-2)" }}>
                {t}
              </span>
              {st && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: !st.configured ? "var(--text-3)" : st.enabled ? "var(--mint)" : "var(--warn)" }} />
              )}
            </button>
          );
        })}
      </aside>

      <div className="space-y-4">
        {tab === "AI engine" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel title="Language model" subtitle="Bring your own key" action={<StatusDot state={live.openai} />}>
              <div className="space-y-3">
                <div className="rounded-2xl px-3 py-2.5 text-[11.5px] leading-relaxed txt-2" style={{ background: "var(--surface-3)" }}>
                  With a key, Iris runs as a reasoning agent: it reads the whole conversation each turn,
                  classifies by root cause, extracts what you already said and asks only the questions that
                  change routing, urgency or the fix. Without a key it falls back to the built-in NLU, which
                  still handles classification, severity, SLA and routing. Stored server-side only.
                </div>
                <Field label="OpenAI API key" value={form.openai_api_key ?? ""} onChange={(v) => set("openai_api_key", v)} type="password" placeholder="sk-…" mono
                  hint="Leave the masked value untouched to keep the existing key." />
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Model</label>
                  <select className="field" value={form.openai_model ?? "gpt-4.1"} onChange={(e) => set("openai_model", e.target.value)}>
                    {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <p className="mt-1 text-[10.5px] txt-3">Used for classification, extraction, question planning and the ticket write-up.</p>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium txt-2">Fast model</label>
                  <select className="field" value={form.openai_model_fast ?? "gpt-4.1-mini"} onChange={(e) => set("openai_model_fast", e.target.value)}>
                    {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <p className="mt-1 text-[10.5px] txt-3">Used for cosmetic rewrites only, where a mistake costs nothing.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium txt-2">Assistant tone</label>
                    <select className="field" value={form.ai_tone ?? "warm"} onChange={(e) => set("ai_tone", e.target.value)}>
                      <option value="warm">Warm &amp; conversational</option>
                      <option value="concise">Concise &amp; efficient</option>
                      <option value="formal">Formal &amp; procedural</option>
                    </select>
                  </div>
                  <Field label="Max follow-up questions" value={form.ai_max_questions ?? "6"} onChange={(v) => set("ai_max_questions", v)} type="number"
                    hint="Iris stops asking and drafts once it hits this." />
                </div>
              </div>
            </Panel>

            <Panel title="AI behaviour" subtitle="What Iris may do">
              <div className="space-y-0.5">
                <Toggle label="Rewrite questions in-flight" hint="Each question is rephrased for the specific situation." checked={bool("ai_rewrite", true)} onChange={(v) => set("ai_rewrite", String(v))} />
                <Toggle label="Enhance message button" hint="Lets staff polish their wording before sending." checked={bool("ai_enhance", true)} onChange={(v) => set("ai_enhance", String(v))} />
                <Toggle label="Auto-set severity & SLA" checked={bool("ai_autosla", true)} onChange={(v) => set("ai_autosla", String(v))} />
                <Toggle label="Suggest root cause & next action" checked={bool("ai_rootcause", true)} onChange={(v) => set("ai_rootcause", String(v))} />
                <Toggle label="Detect churn risk" checked={bool("ai_churn", true)} onChange={(v) => set("ai_churn", String(v))} />
                <Toggle label="Auto-attach Momence records" checked={bool("ai_momence", true)} onChange={(v) => set("ai_momence", String(v))} />
              </div>
            </Panel>
          </div>
        )}

        {tab === "Momence" && (
          <Panel title="Momence" subtitle="OAuth2 password grant · api.momence.com/api/v2"
            action={<span className="chip" style={{ background: connected ? "var(--mint-soft)" : "var(--danger-soft)", color: connected ? "var(--mint)" : "var(--danger)" }}>
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "live-dot" : ""}`} style={{ background: connected ? "var(--mint)" : "var(--danger)" }} />
              {connected ? `Host ${momenceHostId ?? ""}` : "Disconnected"}
            </span>}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Client ID" value={form.momence_client_id ?? ""} onChange={(v) => set("momence_client_id", v)} mono />
              <Field label="Client secret" value={form.momence_client_secret ?? ""} onChange={(v) => set("momence_client_secret", v)} type="password" mono />
              <Field label="Username" value={form.momence_username ?? ""} onChange={(v) => set("momence_username", v)} />
              <Field label="Password" value={form.momence_password ?? ""} onChange={(v) => set("momence_password", v)} type="password" />
            </div>
            <div className="mt-4 space-y-0.5">
              <Toggle label="Allow booking cancellations" checked={bool("mom_cancel", true)} onChange={(v) => set("mom_cancel", String(v))} />
              <Toggle label="Allow membership freeze / unfreeze" checked={bool("mom_freeze", true)} onChange={(v) => set("mom_freeze", String(v))} />
              <Toggle label="Allow credit adjustments" checked={bool("mom_credits", true)} onChange={(v) => set("mom_credits", String(v))} />
              <Toggle label="Allow adding members to classes" checked={bool("mom_addfree", true)} onChange={(v) => set("mom_addfree", String(v))} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => void apiFetch<{ connected?: boolean; hostId?: number }>("/api/momence?resource=status").then((d) => { setConnected(!!d.connected); flash(d.connected ? `Connected to host ${d.hostId}.` : "Connection failed.", !!d.connected); })} className="btn btn-ghost">
                Test connection
              </button>
              <a href="/momence" className="btn btn-primary">Open console</a>
            </div>
          </Panel>
        )}

        {tab === "Fillout" && (
          <div className="space-y-4">
            <Panel title="Fillout ingestion" subtitle="Evaluations feed trainer profiles" action={<StatusDot state={live.fillout} />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Supabase service token" value={form.fillout_supabase_token ?? ""} onChange={(v) => set("fillout_supabase_token", v)} type="password" mono
                  hint="Calls the fillout-* edge functions for historic import." />
                <Field label="Inbound webhook secret" value={form.fillout_webhook_secret ?? ""} onChange={(v) => set("fillout_webhook_secret", v)} type="password" mono
                  hint="Sent as x-fillout-webhook-secret." />
                <Field label="Fillout API token" value={form.fillout_api_key ?? ""} onChange={(v) => set("fillout_api_key", v)} type="password" mono
                  hint="Falls back to the FILLOUT_TOKEN environment secret." />
                <Field label="Fillout base URL" value={form.fillout_base_url ?? ""} onChange={(v) => set("fillout_base_url", v)} mono
                  placeholder="https://api.fillout.com/v1/api"
                  hint="Falls back to the FILLOUT_BASE_URL secret." />
              </div>
              <div className="mt-3 rounded-2xl px-3 py-2.5 text-[11.5px] leading-relaxed txt-2" style={{ background: "var(--surface-3)" }}>
                Point your Fillout webhook at <code className="accent-txt">/api/fillout</code>. Every submission is
                mapped through the weighted rubric, scored, and written onto the trainer profile — creating the
                trainer record if it does not exist yet.
              </div>
              <div className="mt-3 space-y-0.5">
                <Toggle label="Auto-create missing trainers" checked={bool("fillout_autocreate", true)} onChange={(v) => set("fillout_autocreate", String(v))} />
                <Toggle label="Mirror evaluations to Supabase" checked={bool("fillout_mirror", false)} onChange={(v) => set("fillout_mirror", String(v))} />
                <Toggle label="Email the trainer's manager on low scores" hint="Triggers when a weighted score falls below 65%." checked={bool("fillout_alert_low", true)} onChange={(v) => set("fillout_alert_low", String(v))} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => void apiFetch<{ ok?: boolean; imported?: number; error?: string }>("/api/fillout?action=historic").then((d) => flash(d.ok ? `Imported ${d.imported} submission(s).` : d.error ?? "Sync failed.", !!d.ok))} className="btn btn-primary">
                  Import historic submissions
                </button>
                <a href="/forms" className="btn btn-ghost">Open forms</a>
              </div>
            </Panel>

            <Panel title="Embedded forms" subtitle="Live IDs rendered on the Forms tab" padded={false}>
              <table className="rpt">
                <thead>
                  <tr><th>Form</th><th>Rubric</th><th>Embed ID</th><th>Embed</th><th>Ingestion</th></tr>
                </thead>
                <tbody>
                  {[
                    ["Strength Lab feedback", "Strength Lab", "srq1c6n7br", "Zite v2", "Webhook"],
                    ["powerCycle feedback", "powerCycle", "pdtcpzhxas", "Zite v2", "Webhook"],
                    ["Barre assessment", "Barre", "dSw2VkfdGqus", "Fillout v1", "API + webhook"],
                    ["Non-technical feedback", "General", "syTsvPww8nus", "Fillout v1", "API + webhook"],
                  ].map((r) => (
                    <tr key={r[2]}>
                      <td className="txt">{r[0]}</td>
                      <td>{r[1]}</td>
                      <td style={{ fontFamily: "ui-monospace, monospace", fontSize: "11px" }}>{r[2]}</td>
                      <td>{r[3]}</td>
                      <td>
                        <span className="chip" style={{ background: r[4] === "Webhook" ? "var(--surface-3)" : "var(--mint-soft)", color: r[4] === "Webhook" ? "var(--text-3)" : "var(--mint)" }}>
                          {r[4]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-3 text-[10.5px] leading-relaxed txt-3">
                Zite forms are not exposed on the Fillout submissions API, so they deliver via the webhook only.
                Point them at <code className="accent-txt">/api/fillout</code>.
              </p>
            </Panel>
          </div>
        )}

        {tab === "Supabase" && (
          <Panel title="Supabase mirror" subtitle="Replicate tickets and evaluations" action={<StatusDot state={live.supabase} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Project URL" value={form.supabase_url ?? ""} onChange={(v) => set("supabase_url", v)} placeholder="https://xxxx.supabase.co" mono />
              <Field label="Service role key" value={form.supabase_service_key ?? ""} onChange={(v) => set("supabase_service_key", v)} type="password" mono />
              <Field label="Ticket table" value={form.supabase_ticket_table ?? "tickets"} onChange={(v) => set("supabase_ticket_table", v)} mono />
              <Field label="Evaluation table" value={form.supabase_eval_table ?? "trainer_reviews"} onChange={(v) => set("supabase_eval_table", v)} mono />
            </div>
            <div className="mt-3 space-y-0.5">
              <Toggle label="Enable mirroring" hint="Upserts on source_ref so re-sends are safe." checked={bool("supabase_enabled", true)} onChange={(v) => set("supabase_enabled", String(v))} />
              <Toggle label="Mirror ticket status changes" checked={bool("supabase_status", true)} onChange={(v) => set("supabase_status", String(v))} />
            </div>
            <button onClick={() => void runTest("test-supabase")} disabled={saving} className="btn btn-ghost mt-3">Test connection</button>
          </Panel>
        )}

        {tab === "Mailtrap" && (
          <Panel title="Mailtrap email" subtitle="Reminders, SLA alerts and digests" action={<StatusDot state={live.mailtrap} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="API token" value={form.mailtrap_token ?? ""} onChange={(v) => set("mailtrap_token", v)} type="password" mono />
              <Field label="Sandbox inbox ID" value={form.mailtrap_inbox_id ?? ""} onChange={(v) => set("mailtrap_inbox_id", v)} mono
                hint="Leave blank to use the live sending API." />
              <Field label="From email" value={form.mailtrap_from_email ?? ""} onChange={(v) => set("mailtrap_from_email", v)} placeholder="alerts@physique57india.com" />
              <Field label="From name" value={form.mailtrap_from_name ?? ""} onChange={(v) => set("mailtrap_from_name", v)} placeholder="Physique 57 IRIS Ai" />
            </div>
            <div className="mt-3 space-y-0.5">
              <Toggle label="Enable email sending" checked={bool("mailtrap_enabled", true)} onChange={(v) => set("mailtrap_enabled", String(v))} />
              <Toggle label="Notify assignee on new tickets" checked={bool("notify_assign", true)} onChange={(v) => set("notify_assign", String(v))} />
              <Toggle label="Alert managers on SLA breach" checked={bool("notify_breach", true)} onChange={(v) => set("notify_breach", String(v))} />
              <Toggle label="Send SLA reminders before breach" checked={bool("notify_reminder", true)} onChange={(v) => set("notify_reminder", String(v))} />
              <Toggle label="Daily digest to leadership" checked={bool("notify_digest", false)} onChange={(v) => set("notify_digest", String(v))} />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Reminder lead time (hours before due)" value={form.notify_lead_hours ?? "2"} onChange={(v) => set("notify_lead_hours", v)} type="number" />
              <Field label="Escalation recipients" value={form.notify_escalation_to ?? ""} onChange={(v) => set("notify_escalation_to", v)} placeholder="mitali@…, saachi@…" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input className="field !w-[220px]" placeholder="you@physique57india.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              <button onClick={() => void runTest("test-mailtrap", testTo)} disabled={saving} className="btn btn-primary">Send test email</button>
            </div>
          </Panel>
        )}

        {tab === "n8n" && (
          <Panel title="n8n workflows" subtitle="Fire a webhook on ticket events" action={<StatusDot state={live.n8n} />}>
            <div className="grid gap-3">
              <Field label="Production webhook URL" value={form.n8n_webhook_url ?? ""} onChange={(v) => set("n8n_webhook_url", v)} placeholder="https://n8n.yourhost.com/webhook/studio-pulse" mono />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Shared secret" value={form.n8n_secret ?? ""} onChange={(v) => set("n8n_secret", v)} type="password" mono
                  hint="Sent as X-Studio-Pulse-Secret." />
                <Field label="Subscribed events" value={form.n8n_events ?? "ticket.created,ticket.breached,ticket.resolved"} onChange={(v) => set("n8n_events", v)} mono
                  hint="Comma separated." />
              </div>
            </div>
            <div className="mt-3 space-y-0.5">
              <Toggle label="Enable n8n dispatch" checked={bool("n8n_enabled", true)} onChange={(v) => set("n8n_enabled", String(v))} />
              <Toggle label="Include full AI analysis in payload" checked={bool("n8n_full_payload", true)} onChange={(v) => set("n8n_full_payload", String(v))} />
            </div>
            <div className="mt-3 rounded-2xl px-3 py-2.5 text-[11px] leading-relaxed txt-2" style={{ background: "var(--surface-3)", fontFamily: "ui-monospace, monospace" }}>
              {`{ "event": "ticket.created", "source": "studio-pulse", "at": "…", "payload": { ticketNumber, title, category, priority, severity, studio, assigneeName, slaDueAt } }`}
            </div>
            <button onClick={() => void runTest("test-n8n")} disabled={saving} className="btn btn-ghost mt-3">Send test event</button>
          </Panel>
        )}

        {tab === "respond.io" && (
          <Panel title="respond.io messaging" subtitle="WhatsApp and omnichannel alerts" action={<StatusDot state={live.respondio} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="API token" value={form.respondio_token ?? ""} onChange={(v) => set("respondio_token", v)} type="password" mono />
              <Field label="Channel ID" value={form.respondio_channel_id ?? ""} onChange={(v) => set("respondio_channel_id", v)} mono
                hint="Numeric channel to send from." />
              <Field label="Default alert recipient" value={form.respondio_default_to ?? ""} onChange={(v) => set("respondio_default_to", v)} placeholder="+919820000000"
                hint="Phone in E.164, or a respond.io contact identifier." />
              <Field label="Escalation group" value={form.respondio_escalation_to ?? ""} onChange={(v) => set("respondio_escalation_to", v)} placeholder="+919820000001" />
            </div>
            <div className="mt-3 space-y-0.5">
              <Toggle label="Enable messaging" checked={bool("respondio_enabled", true)} onChange={(v) => set("respondio_enabled", String(v))} />
              <Toggle label="Message on Critical severity only" checked={bool("respondio_critical_only", false)} onChange={(v) => set("respondio_critical_only", String(v))} />
              <Toggle label="Message on SLA breach" checked={bool("respondio_breach", true)} onChange={(v) => set("respondio_breach", String(v))} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input className="field !w-[200px]" placeholder="+9198…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              <button onClick={() => void runTest("test-respond", testTo)} disabled={saving} className="btn btn-primary">Send test message</button>
              <button
                onClick={async () => {
                  setSaving(true);
                  try {
                    const d = await apiFetch<{ ok?: boolean; count?: number; error?: string }>("/api/respond/templates", { method: "POST" });
                    flash(d.ok ? `Synced ${d.count} WhatsApp template(s).` : d.error ?? "Sync failed.", !!d.ok);
                  } catch {
                    flash("Sync failed.", false);
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="btn btn-ghost"
              >
                Sync WhatsApp templates
              </button>
            </div>
          </Panel>
        )}

        {tab === "SLA policy" && (
          <Panel title="Response & resolution targets" subtitle="Baseline per category — AI severity compresses these; edit to override" padded={false}>
            <div className="hide-scrollbar max-h-[540px] overflow-auto">
              <table className="rpt">
                <thead>
                  <tr>
                    <th>Category</th><th>Owning team</th><th>Policy</th>
                    <th style={{ textAlign: "right" }}>First response (h)</th>
                    <th style={{ textAlign: "right" }}>Resolution (h)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {slaRows.map((r) => (
                    <tr key={r.category}>
                      <td className="txt">
                        {r.category}
                        {r.overridden && <span className="ml-1.5 chip accent-soft !text-[9px]">custom</span>}
                      </td>
                      <td>{r.department}</td>
                      <td>{r.label}</td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          className="field !w-[80px] !py-1 text-right"
                          value={r.respond}
                          onChange={(e) => setSlaOverride(r.category, { respond: Number(e.target.value) })}
                        />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          step="0.25"
                          min="0"
                          className="field !w-[80px] !py-1 text-right"
                          value={r.resolve}
                          onChange={(e) => setSlaOverride(r.category, { resolve: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        {r.overridden && (
                          <button onClick={() => clearSlaOverride(r.category)} className="btn btn-ghost !px-2 !py-1 !text-[10.5px]">
                            Reset
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-[10.5px] leading-relaxed txt-3">
              Values shown are hours. Overrides apply at the category level and are saved with the rest of Settings —
              press &ldquo;Save settings&rdquo; below. Sharper subcategory-specific rules (e.g. life-safety issues) are not affected.
            </p>
          </Panel>
        )}

        {tab === "Workspace" && (
          <div className="space-y-4">
          <Panel title="Historic data import" subtitle="Bulk-load the Athena ticket archive">
            <div className="rounded-2xl px-3 py-2.5 text-[11.5px] leading-relaxed txt-2" style={{ background: "var(--surface-3)" }}>
              Imports the archived Athena analysis set — 464 enriched tickets spanning 2022 to 2026, complete with
              root cause, recommended actions, sentiment and ownership. Mapped onto our taxonomy and idempotent on
              ticket number, so running it twice is safe.
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={async () => {
                  setSaving(true);
                  try {
                    const d = await apiFetch<{
                      ok?: boolean; imported?: number; skipped?: number; error?: string;
                    }>("/api/historic", { method: "POST" });
                    flash(d.ok ? `Imported ${d.imported}, skipped ${d.skipped} duplicates.` : d.error ?? "Import failed.", !!d.ok);
                  } finally { setSaving(false); }
                }}
                disabled={saving}
                className="btn btn-primary disabled:opacity-50"
              >
                Import historic tickets
              </button>
              <button
                onClick={async () => {
                  const d = await apiFetch<{ imported: number; available: number }>("/api/historic");
                  flash(`${d.imported} of ${d.available} historic tickets already in the database.`, true);
                }}
                className="btn btn-ghost"
              >
                Check status
              </button>
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Ticket rules" subtitle="Guardrails for the queue">
              <div className="space-y-0.5">
                <Toggle label="Only the assignee can resolve" hint="Leadership roles always retain an override." checked={bool("rule_owner_only", true)} onChange={(v) => set("rule_owner_only", String(v))} />
                <Toggle label="Require resolution notes to close" checked={bool("rule_notes", true)} onChange={(v) => set("rule_notes", String(v))} />
                <Toggle label="Auto-assign by live workload" checked={bool("rule_workload", true)} onChange={(v) => set("rule_workload", String(v))} />
                <Toggle label="Allow reopening closed tickets" checked={bool("rule_reopen", false)} onChange={(v) => set("rule_reopen", String(v))} />
                <Toggle label="Auto-close resolved after 7 days" checked={bool("rule_autoclose", false)} onChange={(v) => set("rule_autoclose", String(v))} />
              </div>
            </Panel>
            <Panel title="Defaults" subtitle="Applied to new tickets">
              <div className="space-y-3">
                <Field label="Default studio" value={form.default_studio ?? ""} onChange={(v) => set("default_studio", v)} placeholder="Leave blank to always ask" />
                <Field label="Working hours (IST)" value={form.work_hours ?? "06:00-22:00"} onChange={(v) => set("work_hours", v)} hint="SLA clocks pause outside these hours when enabled." />
                <Toggle label="Pause SLA outside working hours" checked={bool("sla_business_hours", false)} onChange={(v) => set("sla_business_hours", String(v))} />
                <Toggle label="Show AI confidence on tickets" checked={bool("ui_show_confidence", true)} onChange={(v) => set("ui_show_confidence", String(v))} />
              </div>
            </Panel>
          </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-50">
            {saving ? "Working…" : "Save settings"}
          </button>
          {message && (
            <span className="animate-pop rounded-full px-3 py-1.5 text-[11.5px] font-medium"
              style={{ background: message.ok ? "var(--mint-soft)" : "var(--danger-soft)", color: message.ok ? "var(--mint)" : "var(--danger)" }}>
              {message.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
