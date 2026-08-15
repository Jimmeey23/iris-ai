import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { classFeedback } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const rows = await db.select().from(classFeedback).orderBy(desc(classFeedback.createdAt)).limit(100);
  return NextResponse.json({ feedback: rows });
}

type Body = {
  ticketId?: number;
  momenceSessionId?: number;
  sessionName?: string;
  sessionStart?: string;
  hostName?: string;
  trainerName?: string;
  studioName?: string;
  attendeeCount?: number;
  hostScore?: number;
  classScore?: number;
  audienceRelevance?: string;
  purchaseIntent?: string;
  conversionCount?: number;
  notes?: string;
  attendees?: Record<string, unknown>[];
  recordedBy?: string;
};

const bodySchema = z.object({
  ticketId: z.number().optional(),
  momenceSessionId: z.number().optional(),
  sessionName: z.string().optional(),
  sessionStart: z.string().optional(),
  hostName: z.string().optional(),
  trainerName: z.string().optional(),
  studioName: z.string().optional(),
  attendeeCount: z.number().optional(),
  hostScore: z.number().optional(),
  classScore: z.number().optional(),
  audienceRelevance: z.string().optional(),
  purchaseIntent: z.string().optional(),
  conversionCount: z.number().optional(),
  notes: z.string().optional(),
  attendees: z.array(z.record(z.string(), z.unknown())).optional(),
  recordedBy: z.string().optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  let body: Body;
  try {
    body = await parseBody(request, bodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }
  const [row] = await db
    .insert(classFeedback)
    .values({
      ticketId: body.ticketId ?? null,
      momenceSessionId: body.momenceSessionId ?? null,
      sessionName: body.sessionName ?? "",
      sessionStart: body.sessionStart ?? null,
      hostName: body.hostName ?? "",
      trainerName: body.trainerName ?? "",
      studioName: body.studioName ?? "",
      attendeeCount: body.attendeeCount ?? (body.attendees?.length ?? 0),
      hostScore: body.hostScore ?? 0,
      classScore: body.classScore ?? 0,
      audienceRelevance: body.audienceRelevance ?? "",
      purchaseIntent: body.purchaseIntent ?? "",
      conversionCount: body.conversionCount ?? 0,
      notes: body.notes ?? "",
      attendees: body.attendees ?? [],
      recordedBy: body.recordedBy ?? "",
    })
    .returning();
  return NextResponse.json({ feedback: row });
}
