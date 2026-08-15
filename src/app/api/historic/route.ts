import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/seed";
import { historicStatus, importHistoricTickets } from "@/lib/historic-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  await ensureSeeded();
  return NextResponse.json(await historicStatus());
}

export async function POST(request: Request) {
  await ensureSeeded();
  let limit: number | undefined;
  try {
    const body = (await request.json()) as { limit?: number };
    if (body.limit !== undefined) {
      const parsed = Number(body.limit);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "limit must be a positive number" }, { status: 400 });
      }
      limit = Math.min(parsed, 20000);
    }
  } catch {
    limit = undefined;
  }
  try {
    const summary = await importHistoricTickets(undefined, { limit });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 },
    );
  }
}
