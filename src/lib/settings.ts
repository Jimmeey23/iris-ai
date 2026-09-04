import { eq } from "drizzle-orm";
import { appSettings } from "@/db/schema";

/**
 * The database is loaded lazily so settings — and therefore the whole LLM
 * layer — can be used in contexts with no DATABASE_URL, such as the eval
 * harness and one-off scripts.
 */
async function database() {
  const mod = await import("@/db");
  return mod.db;
}

export const SETTING_KEYS = [
  "openai_api_key",
  "openai_model",
  "openai_model_fast",
  "momence_client_id",
  "momence_client_secret",
  "momence_username",
  "momence_password",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export async function getSetting(key: SettingKey | string): Promise<string> {
  try {
    const db = await database();
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return row?.value ?? "";
  } catch {
    return "";
  }
}

export async function getSettings(): Promise<Record<string, string>> {
  try {
    const db = await database();
    const rows = await db.select().from(appSettings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await database();
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function getOpenAiKey(): Promise<string> {
  return (await getSetting("openai_api_key")) || process.env.OPENAI_API_KEY || "";
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

/** Seed Momence credentials from env once so the integration works out of the box. */
export async function ensureMomenceDefaults(): Promise<void> {
  const defaults: Record<string, string | undefined> = {
    momence_client_id: process.env.MOMENCE_CLIENT_ID,
    momence_client_secret: process.env.MOMENCE_CLIENT_SECRET,
    momence_username: process.env.MOMENCE_USERNAME,
    momence_password: process.env.MOMENCE_PASSWORD,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!value) continue;
    const existing = await getSetting(key);
    if (!existing) await setSetting(key, value);
  }
}
