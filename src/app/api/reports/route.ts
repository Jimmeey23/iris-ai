import { NextResponse } from "next/server";
import { and, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { classFeedback, trainerEvaluations, tickets } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { REPORTS, getReport, toCsv, type ReportContext } from "@/lib/reports";

export const dynamic = "force-dynamic";

const PERIODS: Record<string, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
  all: 3650,
};

async function buildContext(params: URLSearchParams): Promise<ReportContext> {
  const period = params.get("period") ?? "30d";
  const days = PERIODS[period] ?? 30;
  const to = params.get("to") ? new Date(params.get("to")!) : new Date();
  const from = params.get("from")
    ? new Date(params.get("from")!)
    : new Date(to.getTime() - days * 86400000);

  const studio = params.get("studio") ?? "all";
  const department = params.get("department") ?? "all";
  const category = params.get("category") ?? "all";

  let rows = await db
    .select()
    .from(tickets)
    .where(and(gte(tickets.createdAt, from), lte(tickets.createdAt, to)));

  if (studio !== "all") rows = rows.filter((t) => t.studioName === studio);
  if (department !== "all") rows = rows.filter((t) => t.department === department);
  if (category !== "all") rows = rows.filter((t) => t.category === category);

  const [evals, feedback] = await Promise.all([
    db.select().from(trainerEvaluations),
    db.select().from(classFeedback),
  ]);

  const evalRows = evals.filter((e) => {
    const at = new Date(e.submittedAt).getTime();
    return at >= from.getTime() && at <= to.getTime();
  });
  const feedbackRows = feedback.filter((f) => {
    const at = new Date(f.createdAt).getTime();
    return at >= from.getTime() && at <= to.getTime();
  });

  return {
    tickets: rows,
    evaluations: evalRows.length ? evalRows : evals,
    classFeedback: feedbackRows.length ? feedbackRows : feedback,
    from,
    to,
    label: `${from.toLocaleDateString("en-IN")} – ${to.toLocaleDateString("en-IN")}`,
  };
}

export async function GET(request: Request) {
  await ensureSeeded();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({
      reports: REPORTS.map((r) => ({ id: r.id, name: r.name, group: r.group, blurb: r.blurb })),
    });
  }

  const report = getReport(id);
  if (!report) return NextResponse.json({ error: "Unknown report" }, { status: 404 });

  const ctx = await buildContext(searchParams);
  const rows = report.build(ctx);

  if (searchParams.get("format") === "csv") {
    return new NextResponse(toCsv(report.columns, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${report.id}-${Date.now()}.csv"`,
      },
    });
  }

  return NextResponse.json({
    id: report.id,
    name: report.name,
    blurb: report.blurb,
    group: report.group,
    columns: report.columns,
    rows,
    period: ctx.label,
    ticketCount: ctx.tickets.length,
  });
}
