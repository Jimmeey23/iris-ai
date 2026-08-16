import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { whatsappTemplates, type WhatsappTemplate } from "@/db/schema";
import { respondConfig } from "./integrations";
import { buildTemplateSendComponents, extractTemplateVariables, type TemplateComponent } from "./whatsapp-templates";

const BASE = "https://api.respond.io/v2";

type RemoteTemplate = {
  id: number;
  name: string;
  label?: string | null;
  languageCode: string;
  category: string;
  status: string;
  channelId: number;
  templateId: string;
  components: TemplateComponent[];
};

async function fetchAllTemplates(channelId: string, token: string): Promise<RemoteTemplate[]> {
  const items: RemoteTemplate[] = [];
  let cursorId: number | undefined;
  for (let page = 0; page < 50; page += 1) {
    const url = new URL(`${BASE}/space/channel/${encodeURIComponent(channelId)}/template`);
    url.searchParams.set("limit", "100");
    if (cursorId !== undefined) url.searchParams.set("cursorId", String(cursorId));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`respond.io template list failed (${res.status})`);
    const json = (await res.json()) as { items: RemoteTemplate[]; pagination?: { next?: string } };
    items.push(...json.items);
    if (!json.pagination?.next || json.items.length === 0) break;
    cursorId = json.items[json.items.length - 1]?.id;
  }
  return items;
}

/** Pull every approved WhatsApp template from respond.io and upsert into our cache table. */
export async function syncWhatsappTemplates(): Promise<{ ok: boolean; count: number; detail?: string }> {
  const cfg = await respondConfig();
  if (!cfg.token) return { ok: false, count: 0, detail: "Add a respond.io API token in Settings." };
  if (!cfg.channelId) return { ok: false, count: 0, detail: "Set the respond.io channel ID in Settings." };

  let remote: RemoteTemplate[];
  try {
    remote = await fetchAllTemplates(cfg.channelId, cfg.token);
  } catch (err) {
    return { ok: false, count: 0, detail: err instanceof Error ? err.message : "Sync failed" };
  }

  for (const t of remote) {
    await db
      .insert(whatsappTemplates)
      .values({
        templateId: t.templateId,
        name: t.name,
        label: t.label ?? null,
        languageCode: t.languageCode,
        category: t.category,
        status: t.status,
        channelId: t.channelId,
        components: t.components,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: whatsappTemplates.templateId,
        set: {
          name: t.name,
          label: t.label ?? null,
          languageCode: t.languageCode,
          category: t.category,
          status: t.status,
          channelId: t.channelId,
          components: t.components,
          syncedAt: new Date(),
        },
      });
  }

  return { ok: true, count: remote.length };
}

export async function listSyncedTemplates(): Promise<WhatsappTemplate[]> {
  return db
    .select()
    .from(whatsappTemplates)
    .where(eq(whatsappTemplates.status, "approved"))
    .orderBy(asc(whatsappTemplates.name));
}

export async function getSyncedTemplate(templateId: string): Promise<WhatsappTemplate | null> {
  const [row] = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.templateId, templateId)).limit(1);
  return row ?? null;
}

export async function getSyncedTemplateByName(name: string): Promise<WhatsappTemplate | null> {
  const [row] = await db.select().from(whatsappTemplates).where(eq(whatsappTemplates.name, name)).limit(1);
  return row ?? null;
}

export type SendTemplateResult = { ok: boolean; messageId?: number; detail?: string };

/** Send a synced WhatsApp template message to a contact, filling in its variables. */
export async function sendWhatsappTemplate(input: {
  to: string;
  templateId: string;
  values: Record<string, string>;
}): Promise<SendTemplateResult> {
  const cfg = await respondConfig();
  if (!cfg.enabled) return { ok: false, detail: "respond.io disabled" };
  if (!cfg.token) return { ok: false, detail: "Add a respond.io API token in Settings." };

  const template = await getSyncedTemplate(input.templateId);
  if (!template) return { ok: false, detail: "Template not found — try syncing again." };

  const variables = extractTemplateVariables(template.components);
  const components = buildTemplateSendComponents(variables, input.values);

  const identifier = input.to.startsWith("+") ? `phone:${input.to}` : input.to;
  try {
    const res = await fetch(`${BASE}/contact/${encodeURIComponent(identifier)}/message`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        channelId: template.channelId,
        message: {
          type: "whatsapp_template",
          template: {
            name: template.name,
            languageCode: template.languageCode,
            components,
          },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string; messageId?: number };
    return res.ok
      ? { ok: true, messageId: body.messageId }
      : { ok: false, detail: body.message ?? `respond.io ${res.status}` };
  } catch {
    return { ok: false, detail: "respond.io request failed" };
  }
}

/**
 * Send a synced template by its human-chosen name, filling body placeholders
 * positionally (bodyValues[0] → {{1}}, etc). Used by automated ticket-lifecycle
 * notifications, which don't have per-key values from a form.
 */
export async function sendTemplateByName(
  to: string,
  name: string,
  bodyValues: string[],
): Promise<SendTemplateResult> {
  const template = await getSyncedTemplateByName(name);
  if (!template) return { ok: false, detail: `Template "${name}" not synced yet.` };

  const variables = extractTemplateVariables(template.components);
  const ordered = [...variables].sort((a, b) => a.placeholderIndex - b.placeholderIndex);
  const values: Record<string, string> = {};
  ordered.forEach((v, i) => {
    values[v.key] = bodyValues[i] ?? "";
  });

  return sendWhatsappTemplate({ to, templateId: template.templateId, values });
}

export type RespondContact = {
  id: number;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  lifecycle: string | null;
  tags: string[];
  customFields: { name: string; value: string | null }[];
  assignee: { id: number; firstName: string; lastName: string; email: string } | null;
};

export async function getRespondContact(identifier: string): Promise<RespondContact | null> {
  const cfg = await respondConfig();
  if (!cfg.token) return null;
  const id = identifier.startsWith("+") ? `phone:${identifier}` : identifier;
  try {
    const res = await fetch(`${BASE}/contact/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      id: number;
      firstName: string;
      lastName?: string | null;
      phone?: string | null;
      email?: string | null;
      lifecycle?: string | null;
      tags?: string[];
      custom_fields?: { name: string; value: string | null }[];
      assignee?: { id: number; firstName: string; lastName: string; email: string } | null;
    };
    return {
      id: json.id,
      firstName: json.firstName,
      lastName: json.lastName ?? null,
      phone: json.phone ?? null,
      email: json.email ?? null,
      lifecycle: json.lifecycle ?? null,
      tags: json.tags ?? [],
      customFields: json.custom_fields ?? [],
      assignee: json.assignee ?? null,
    };
  } catch {
    return null;
  }
}

export type RespondMessage = {
  messageId: number;
  traffic: "outgoing" | "incoming";
  type: string;
  text: string | null;
  status: string | null;
};

export async function listRespondMessages(identifier: string, limit = 20): Promise<RespondMessage[]> {
  const cfg = await respondConfig();
  if (!cfg.token) return [];
  const id = identifier.startsWith("+") ? `phone:${identifier}` : identifier;
  try {
    const res = await fetch(
      `${BASE}/contact/${encodeURIComponent(id)}/message/list?limit=${Math.min(limit, 50)}`,
      { headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      items: {
        messageId: number;
        traffic: "outgoing" | "incoming";
        message: { type: string; text?: string };
        status?: { value: string }[];
      }[];
    };
    return json.items.map((m) => ({
      messageId: m.messageId,
      traffic: m.traffic,
      type: m.message.type,
      text: m.message.text ?? null,
      status: m.status?.[m.status.length - 1]?.value ?? null,
    }));
  } catch {
    return [];
  }
}
