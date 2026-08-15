import { getSetting, getSettings } from "./settings";

export type TestResult = { ok: boolean; detail: string };

/* ------------------------------------------------------------------ */
/* Supabase — mirror tickets & evaluations to an external project      */
/* ------------------------------------------------------------------ */

export async function supabaseConfig() {
  const s = await getSettings();
  return {
    url: (s.supabase_url || process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    key: s.supabase_service_key || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    ticketTable: s.supabase_ticket_table || "tickets",
    evalTable: s.supabase_eval_table || "trainer_reviews",
    enabled: s.supabase_enabled !== "false",
  };
}

export async function supabaseTest(): Promise<TestResult> {
  const cfg = await supabaseConfig();
  if (!cfg.url || !cfg.key) return { ok: false, detail: "Add the project URL and service role key." };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${cfg.ticketTable}?select=id&limit=1`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) return { ok: true, detail: `Reached ${cfg.ticketTable} on ${new URL(cfg.url).host}.` };
    if (res.status === 404) return { ok: false, detail: `Table "${cfg.ticketTable}" not found in that project.` };
    return { ok: false, detail: `Supabase responded ${res.status}.` };
  } catch {
    return { ok: false, detail: "Could not reach Supabase." };
  }
}

export async function supabaseUpsert(table: "ticket" | "eval", row: Record<string, unknown>): Promise<TestResult> {
  const cfg = await supabaseConfig();
  if (!cfg.enabled || !cfg.url || !cfg.key) return { ok: false, detail: "Supabase not configured" };
  const target = table === "ticket" ? cfg.ticketTable : cfg.evalTable;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${target}?on_conflict=source_ref`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(9000),
    });
    return res.ok
      ? { ok: true, detail: `Mirrored to ${target}` }
      : { ok: false, detail: `Supabase ${res.status}` };
  } catch {
    return { ok: false, detail: "Supabase request failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Mailtrap — transactional email for reminders and alerts             */
/* ------------------------------------------------------------------ */

export async function mailtrapConfig() {
  const s = await getSettings();
  return {
    token: s.mailtrap_token || process.env.MAILTRAP_TOKEN || "",
    fromEmail: s.mailtrap_from_email || "alerts@physique57india.com",
    fromName: s.mailtrap_from_name || "Physique 57 IRIS Ai",
    sandboxInbox: s.mailtrap_inbox_id || "",
    enabled: s.mailtrap_enabled !== "false",
  };
}

function mailtrapEndpoint(inbox: string) {
  return inbox
    ? `https://sandbox.api.mailtrap.io/api/send/${inbox}`
    : "https://send.api.mailtrap.io/api/send";
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  category?: string;
}): Promise<TestResult> {
  const cfg = await mailtrapConfig();
  if (!cfg.enabled) return { ok: false, detail: "Mailtrap disabled" };
  if (!cfg.token) return { ok: false, detail: "Add a Mailtrap API token in Settings." };
  try {
    const res = await fetch(mailtrapEndpoint(cfg.sandboxInbox), {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: { email: cfg.fromEmail, name: cfg.fromName },
        to: [{ email: input.to }],
        subject: input.subject,
        html: input.html,
        text: input.text ?? input.html.replace(/<[^>]+>/g, " "),
        category: input.category ?? "studio-pulse",
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => ({}))) as { errors?: string[]; message_ids?: string[] };
    if (res.ok) return { ok: true, detail: `Sent to ${input.to}${body.message_ids?.[0] ? ` (${body.message_ids[0]})` : ""}` };
    return { ok: false, detail: body.errors?.join("; ") ?? `Mailtrap ${res.status}` };
  } catch {
    return { ok: false, detail: "Mailtrap request failed" };
  }
}

export async function mailtrapTest(to: string): Promise<TestResult> {
  return sendEmail({
    to,
    subject: "IRIS Ai — integration test",
    category: "integration-test",
    html: `<div style="font-family:Outfit,system-ui,sans-serif;padding:24px">
      <h2 style="font-family:'Instrument Serif',serif;font-weight:400;margin:0 0 6px">Mailtrap is wired up</h2>
      <p style="color:#5c6578;font-size:13px;margin:0">IRIS Ai can now send SLA reminders, breach alerts and daily digests.</p>
    </div>`,
  });
}

/* ------------------------------------------------------------------ */
/* n8n — fire workflow webhooks                                        */
/* ------------------------------------------------------------------ */

export async function n8nConfig() {
  const s = await getSettings();
  return {
    url: s.n8n_webhook_url || process.env.N8N_WEBHOOK_URL || "",
    secret: s.n8n_secret || "",
    enabled: s.n8n_enabled !== "false",
    events: (s.n8n_events || "ticket.created,ticket.breached,ticket.resolved").split(","),
  };
}

export async function n8nTrigger(event: string, payload: Record<string, unknown>): Promise<TestResult> {
  const cfg = await n8nConfig();
  if (!cfg.enabled || !cfg.url) return { ok: false, detail: "n8n not configured" };
  if (!cfg.events.includes(event) && event !== "test") {
    return { ok: false, detail: `Event ${event} not subscribed` };
  }
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.secret ? { "X-Studio-Pulse-Secret": cfg.secret } : {}),
      },
      body: JSON.stringify({ event, source: "studio-pulse", at: new Date().toISOString(), payload }),
      signal: AbortSignal.timeout(9000),
    });
    return res.ok ? { ok: true, detail: `n8n accepted ${event}` } : { ok: false, detail: `n8n ${res.status}` };
  } catch {
    return { ok: false, detail: "Could not reach the n8n webhook" };
  }
}

/* ------------------------------------------------------------------ */
/* respond.io — WhatsApp / omnichannel messaging                       */
/* ------------------------------------------------------------------ */

export async function respondConfig() {
  const s = await getSettings();
  return {
    token: s.respondio_token || process.env.RESPONDIO_TOKEN || "",
    channelId: s.respondio_channel_id || "",
    enabled: s.respondio_enabled !== "false",
    defaultTo: s.respondio_default_to || "",
  };
}

export async function respondSend(input: {
  to: string;
  text: string;
  channelId?: string;
}): Promise<TestResult> {
  const cfg = await respondConfig();
  if (!cfg.enabled) return { ok: false, detail: "respond.io disabled" };
  if (!cfg.token) return { ok: false, detail: "Add a respond.io API token in Settings." };
  const identifier = input.to.startsWith("+") ? `phone:${input.to}` : input.to;
  try {
    const res = await fetch(`https://api.respond.io/v2/contact/${encodeURIComponent(identifier)}/message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: input.channelId ?? (cfg.channelId ? Number(cfg.channelId) : undefined),
        message: { type: "text", text: input.text },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string; messageId?: number };
    return res.ok
      ? { ok: true, detail: `Message queued${body.messageId ? ` (#${body.messageId})` : ""}` }
      : { ok: false, detail: body.message ?? `respond.io ${res.status}` };
  } catch {
    return { ok: false, detail: "respond.io request failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Event fan-out                                                       */
/* ------------------------------------------------------------------ */

export type TicketEventPayload = {
  ticketNumber: string;
  title: string;
  category: string;
  subcategory: string;
  priority: string;
  severity: string;
  studio: string;
  assigneeName: string | null;
  assigneeEmail: string | null;
  slaHours: number;
  slaDueAt: string | null;
  url?: string;
};

function emailTemplate(event: string, t: TicketEventPayload): { subject: string; html: string } {
  const accent = "#005eed";
  const label =
    event === "ticket.created" ? "New ticket assigned" :
    event === "ticket.breached" ? "SLA breached" :
    event === "ticket.reminder" ? "SLA reminder" : "Ticket update";
  return {
    subject: `${label} · ${t.ticketNumber} — ${t.title.slice(0, 60)}`,
    html: `<div style="font-family:Outfit,system-ui,sans-serif;background:#fff;padding:28px;color:#0e1729">
      <div style="max-width:560px;margin:0 auto">
        <div style="font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#5c6578">${label}</div>
        <h1 style="font-family:'Instrument Serif',serif;font-weight:400;font-size:26px;margin:8px 0 4px">${t.title}</h1>
        <div style="font-size:12px;color:#5c6578;margin-bottom:18px">${t.ticketNumber} · ${t.category} › ${t.subcategory}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          ${[
            ["Studio", t.studio],
            ["Priority", `${t.priority} (${t.severity})`],
            ["Owner", t.assigneeName ?? "Unassigned"],
            ["SLA target", t.slaDueAt ? new Date(t.slaDueAt).toLocaleString("en-IN") : `${t.slaHours}h`],
          ]
            .map(
              ([k, v]) =>
                `<tr><td style="padding:7px 0;color:#5c6578;width:120px">${k}</td><td style="padding:7px 0;font-weight:500">${v}</td></tr>`,
            )
            .join("")}
        </table>
        ${t.url ? `<a href="${t.url}" style="display:inline-block;margin-top:18px;background:${accent};color:#fff;text-decoration:none;padding:10px 18px;border-radius:12px;font-size:13px;font-weight:600">Open ticket</a>` : ""}
        <p style="margin-top:24px;border-top:1px solid #efefef;padding-top:12px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#5c6578">Physique 57 — IRIS Ai</p>
      </div></div>`,
  };
}

/** Fan a ticket event out to every enabled channel. Never throws. */
export async function dispatchTicketEvent(
  event: "ticket.created" | "ticket.breached" | "ticket.resolved" | "ticket.reminder",
  t: TicketEventPayload,
): Promise<{ channel: string; ok: boolean; detail: string }[]> {
  const settings = await getSettings();
  const results: { channel: string; ok: boolean; detail: string }[] = [];

  const wantEmail =
    (event === "ticket.created" && settings.notify_assign !== "false") ||
    (event === "ticket.breached" && settings.notify_breach !== "false") ||
    event === "ticket.reminder";

  if (wantEmail && t.assigneeEmail) {
    const tpl = emailTemplate(event, t);
    const r = await sendEmail({ to: t.assigneeEmail, subject: tpl.subject, html: tpl.html, category: event });
    results.push({ channel: "mailtrap", ...r });
  }

  const n8n = await n8nTrigger(event, t as unknown as Record<string, unknown>);
  if (n8n.detail !== "n8n not configured") results.push({ channel: "n8n", ...n8n });

  const respond = await respondConfig();
  if (respond.enabled && respond.token && respond.defaultTo && event !== "ticket.resolved") {
    const r = await respondSend({
      to: respond.defaultTo,
      text: `${event === "ticket.breached" ? "⚠️ SLA BREACH" : "🎫 New ticket"} ${t.ticketNumber}\n${t.title}\n${t.studio} · ${t.priority}/${t.severity}\nOwner: ${t.assigneeName ?? "unassigned"}`,
    });
    results.push({ channel: "respond.io", ...r });
  }

  const sb = await supabaseConfig();
  if (sb.enabled && sb.url && sb.key) {
    const r = await supabaseUpsert("ticket", {
      source_ref: t.ticketNumber,
      title: t.title,
      category: t.category,
      sub_category: t.subcategory,
      priority: t.priority,
      severity: t.severity,
      studio: t.studio,
      assigned_to: t.assigneeName,
      sla_due_at: t.slaDueAt,
      event,
      updated_at: new Date().toISOString(),
    });
    results.push({ channel: "supabase", ...r });
  }

  return results;
}

export async function integrationStatus() {
  const s = await getSettings();
  return {
    supabase: { configured: !!(s.supabase_url && s.supabase_service_key), enabled: s.supabase_enabled !== "false" },
    mailtrap: { configured: !!s.mailtrap_token, enabled: s.mailtrap_enabled !== "false" },
    n8n: { configured: !!s.n8n_webhook_url, enabled: s.n8n_enabled !== "false" },
    respondio: { configured: !!s.respondio_token, enabled: s.respondio_enabled !== "false" },
    openai: { configured: (await getSetting("openai_api_key")).startsWith("sk-") || !!process.env.OPENAI_API_KEY, enabled: true },
    fillout: {
      configured: !!(s.fillout_api_key || process.env.FILLOUT_TOKEN),
      enabled: true,
    },
  };
}
