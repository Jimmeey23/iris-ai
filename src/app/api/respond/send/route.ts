import { NextResponse } from "next/server";
import { z } from "zod";
import { sendWhatsappTemplate } from "@/lib/respond-templates";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  to: z.string().min(1),
  templateId: z.string().min(1),
  values: z.record(z.string(), z.string()).optional(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }

  const result = await sendWhatsappTemplate({ to: body.to, templateId: body.templateId, values: body.values ?? {} });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
