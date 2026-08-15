import { NextResponse } from "next/server";
import { listSyncedTemplates, syncWhatsappTemplates } from "@/lib/respond-templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const templates = await listSyncedTemplates();
  return NextResponse.json({ templates });
}

export async function POST() {
  const result = await syncWhatsappTemplates();
  if (!result.ok) {
    return NextResponse.json({ error: result.detail ?? "Sync failed" }, { status: 502 });
  }
  const templates = await listSyncedTemplates();
  return NextResponse.json({ ok: true, count: result.count, templates });
}
