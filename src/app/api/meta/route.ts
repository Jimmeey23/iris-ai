import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/seed";
import { getStaff, getStudios, getDashboardStats } from "@/lib/tickets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const [studios, staff] = await Promise.all([getStudios(), getStaff()]);
  const stats = searchParams.get("stats") === "1" ? await getDashboardStats() : null;
  return NextResponse.json({ studios, staff, stats });
}
