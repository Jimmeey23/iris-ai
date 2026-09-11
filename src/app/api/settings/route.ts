import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, maskSecret, setSetting } from "@/lib/settings";
import { momenceStatus } from "@/lib/momence";
import { ensureSeeded } from "@/lib/seed";
import { getSessionUser } from "@/lib/session";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

const SECRET_KEYS = [
  "openai_api_key",
  "momence_client_secret",
  "momence_password",
  "fillout_supabase_token",
  "fillout_webhook_secret",
  "fillout_api_key",
  "supabase_service_key",
  "mailtrap_token",
  "mailtrap_signing_secret",
  "n8n_secret",
  "respondio_token",
];

export async function GET() {
  await ensureSeeded();
  const raw = await getSettings();
  const momence = await momenceStatus();
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    safe[key] = SECRET_KEYS.includes(key) ? maskSecret(value) : value;
  }
  return NextResponse.json({
    settings: safe,
    openaiConfigured: (raw.openai_api_key ?? "").startsWith("sk-") || !!process.env.OPENAI_API_KEY,
    momence,
  });
}

const settingsBodySchema = z.record(z.string(), z.string());

export async function POST(request: Request) {
  const actor = await getSessionUser();
  if (actor?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can change settings" }, { status: 403 });
  }

  let body: Record<string, string>;
  try {
    body = await parseBody(request, settingsBodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }
  const allowed = /^(openai_|momence_|fillout_|ai_|mom_|notify_|rule_|default_|supabase_|mailtrap_|n8n_|respondio_|sla_|ui_|work_)/;
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.test(key)) continue;
    if (typeof value !== "string") continue;
    if (value.includes("••")) continue; // masked, unchanged
    await setSetting(key, value.trim());
  }
  const momence = await momenceStatus();
  return NextResponse.json({ ok: true, momence });
}
