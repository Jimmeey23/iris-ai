"use client";

import { useEffect, useMemo, useState } from "react";
import type { WhatsappTemplate } from "@/db/schema";
import { apiFetch, apiPost, ApiError } from "@/lib/api-client";
import { extractTemplateVariables } from "@/lib/whatsapp-templates";

type Contact = {
  firstName: string;
  lastName: string | null;
  lifecycle: string | null;
  tags: string[];
} | null;

type Message = { messageId: number; traffic: "outgoing" | "incoming"; type: string; text: string | null };

export default function MessageTemplatePanel({ to }: { to: string }) {
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
  const [contact, setContact] = useState<Contact>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showMessages, setShowMessages] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    apiFetch<{ templates: WhatsappTemplate[] }>("/api/respond/templates")
      .then((d) => setTemplates(d.templates))
      .catch(() => setTemplates([]));
    apiFetch<{ contact: Contact; messages: Message[] }>(`/api/respond/contact?identifier=${encodeURIComponent(to)}`)
      .then((d) => {
        setContact(d.contact);
        setMessages(d.messages);
      })
      .catch(() => {});
  }, [to]);

  const selected = templates.find((t) => t.templateId === templateId) ?? null;
  const variables = useMemo(
    () => (selected ? extractTemplateVariables(selected.components) : []),
    [selected],
  );

  const send = async () => {
    if (!selected) return;
    setSending(true);
    setResult(null);
    try {
      const d = await apiPost<{ ok: boolean; detail?: string }>("/api/respond/send", {
        to,
        templateId: selected.templateId,
        values,
      });
      setResult({ text: d.ok ? "Sent." : d.detail ?? "Send failed.", ok: d.ok });
    } catch (err) {
      setResult({ text: err instanceof ApiError ? err.message : "Send failed.", ok: false });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="panel rounded-2xl p-5 space-y-3">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] txt-3">Message member</span>

      {contact && (
        <div className="rounded-xl px-3 py-2 text-[11.5px] leading-relaxed txt-2" style={{ background: "var(--surface-3)" }}>
          <span className="font-medium txt">
            {contact.firstName} {contact.lastName ?? ""}
          </span>
          {contact.lifecycle && <span className="ml-2 chip accent-soft !text-[9.5px]">{contact.lifecycle}</span>}
          {contact.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {contact.tags.map((tag) => (
                <span key={tag} className="chip surface-3 !text-[9.5px]">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {messages.length > 0 && (
        <div>
          <button onClick={() => setShowMessages((s) => !s)} className="text-[11px] txt-3 underline">
            {showMessages ? "Hide" : "Show"} recent WhatsApp messages ({messages.length})
          </button>
          {showMessages && (
            <div className="mt-2 max-h-[180px] space-y-1.5 overflow-y-auto rounded-xl p-2.5" style={{ background: "var(--surface-3)" }}>
              {messages.map((m) => (
                <div key={m.messageId} className="text-[11px] leading-relaxed">
                  <span className="txt-3">{m.traffic === "outgoing" ? "→" : "←"}</span>{" "}
                  <span className="txt-2">{m.text ?? `[${m.type}]`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <label className="mb-1 block text-[11px] font-medium txt-2">Template</label>
        <select
          className="field"
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value);
            setValues({});
            setResult(null);
          }}
        >
          <option value="">Select a template…</option>
          {templates.map((t) => (
            <option key={t.templateId} value={t.templateId}>
              {t.label ?? t.name} ({t.languageCode})
            </option>
          ))}
        </select>
        {templates.length === 0 && (
          <p className="mt-1 text-[10.5px] txt-3">No templates synced yet — sync from Settings → respond.io.</p>
        )}
      </div>

      {variables.length > 0 && (
        <div className="space-y-2">
          {variables.map((v) => (
            <div key={v.key}>
              <label className="mb-1 block text-[11px] font-medium txt-2">{v.label}</label>
              <input
                className="field"
                value={values[v.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      {result && (
        <p className={`rounded-lg px-3 py-2 text-[11px] ${result.ok ? "mint-soft" : "danger-soft"}`}>{result.text}</p>
      )}

      <button
        disabled={!selected || sending}
        onClick={() => void send()}
        className="btn btn-primary w-full disabled:opacity-40"
      >
        {sending ? "Sending…" : "Send template"}
      </button>
    </div>
  );
}
