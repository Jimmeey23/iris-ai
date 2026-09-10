"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Paste a forwarded email into Iris — same triage pipeline as the webhook. */
export default function InboxComposer() {
  const router = useRouter();
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    setErr(false);
    try {
      const res = await fetch("/api/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromEmail, fromName: fromName || undefined, subject, text }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        ticketNumber?: string;
        error?: string;
      };
      if (!res.ok) {
        setErr(true);
        setMsg(body.error ?? "Triage failed — the email is stored and can be retried.");
        return;
      }
      setMsg(
        body.status === "duplicate"
          ? "Already ingested — no duplicate ticket raised."
          : `Ticket ${body.ticketNumber ?? ""} raised and routed.`,
      );
      setText("");
      setSubject("");
      router.refresh();
    } catch {
      setErr(true);
      setMsg("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const ready = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fromEmail) && subject.trim().length > 0 && text.trim().length > 2;

  return (
    <div className="panel rounded-2xl p-5">
      <h2 className="serif text-[17px] leading-none txt">Forward an email to Iris</h2>
      <p className="mt-1 text-[11.5px] txt-3">
        Paste what a member or colleague sent — Iris triages it into a routed ticket and drafts the reply for
        approval. The live mailbox hookup is the same pipeline via the inbound webhook.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <input className="input text-[12.5px]" placeholder="From name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
        <input
          className="input text-[12.5px]"
          placeholder="From email *"
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
        />
        <input
          className="input text-[12.5px]"
          placeholder="Subject *"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <textarea
        className="input mt-2 w-full resize-y text-[12.5px]"
        rows={5}
        placeholder="The email body — forwarded threads are fine, quoted history is stripped automatically."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn btn-primary !text-[12px]" onClick={submit} disabled={busy || !ready}>
          {busy ? "Triaging…" : "Triage into ticket"}
        </button>
        {msg && (
          <span className="text-[12px]" style={{ color: err ? "var(--danger)" : "var(--mint)" }}>
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
