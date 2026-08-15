import { NextResponse } from "next/server";
import { z } from "zod";
import {
  dispatchTicketEvent,
  integrationStatus,
  mailtrapTest,
  n8nTrigger,
  respondSend,
  supabaseTest,
} from "@/lib/integrations";
import { ensureSeeded } from "@/lib/seed";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  return NextResponse.json(await integrationStatus());
}

type Body = {
  action: "test-supabase" | "test-mailtrap" | "test-n8n" | "test-respond" | "dispatch";
  to?: string;
  event?: "ticket.created" | "ticket.breached" | "ticket.resolved" | "ticket.reminder";
  payload?: Record<string, unknown>;
};

const bodySchema = z.object({
  action: z.enum(["test-supabase", "test-mailtrap", "test-n8n", "test-respond", "dispatch"]),
  to: z.string().optional(),
  event: z.enum(["ticket.created", "ticket.breached", "ticket.resolved", "ticket.reminder"]).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await parseBody(request, bodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }

  switch (body.action) {
    case "test-supabase":
      return NextResponse.json(await supabaseTest());

    case "test-mailtrap": {
      if (!body.to) return NextResponse.json({ ok: false, detail: "Enter a recipient email." });
      return NextResponse.json(await mailtrapTest(body.to));
    }

    case "test-n8n":
      return NextResponse.json(
        await n8nTrigger("test", { message: "IRIS Ai integration test", at: new Date().toISOString() }),
      );

    case "test-respond": {
      if (!body.to) return NextResponse.json({ ok: false, detail: "Enter a phone number or contact id." });
      return NextResponse.json(
        await respondSend({ to: body.to, text: "IRIS Ai integration test — messaging is connected." }),
      );
    }

    case "dispatch": {
      const results = await dispatchTicketEvent(body.event ?? "ticket.created", {
        ticketNumber: String(body.payload?.ticketNumber ?? "P57-TEST"),
        title: String(body.payload?.title ?? "Integration test ticket"),
        category: String(body.payload?.category ?? "Miscellaneous"),
        subcategory: String(body.payload?.subcategory ?? "Test"),
        priority: String(body.payload?.priority ?? "Medium"),
        severity: String(body.payload?.severity ?? "Moderate"),
        studio: String(body.payload?.studio ?? "Kwality House, Kemps Corner"),
        assigneeName: (body.payload?.assigneeName as string) ?? null,
        assigneeEmail: (body.payload?.assigneeEmail as string) ?? null,
        slaHours: Number(body.payload?.slaHours ?? 24),
        slaDueAt: (body.payload?.slaDueAt as string) ?? null,
        url: (body.payload?.url as string) ?? undefined,
      });
      return NextResponse.json({ ok: results.some((r) => r.ok), results });
    }

    default:
      return NextResponse.json({ ok: false, detail: "Unknown action" }, { status: 400 });
  }
}
