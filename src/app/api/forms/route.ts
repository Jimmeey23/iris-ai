import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customFilloutForms } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { extractEmbed, getAllForms } from "@/lib/fillout";
import { TRAINER_TEMPLATES } from "@/lib/catalog";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const forms = await getAllForms();
  return NextResponse.json({ forms });
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

const bodySchema = z.object({
  name: z.string().min(1),
  blurb: z.string().optional(),
  template: z.enum(TRAINER_TEMPLATES).optional(),
  embedCode: z.string().min(1),
  height: z.number().optional(),
  icon: z.string().optional(),
});

export async function POST(request: Request) {
  await ensureSeeded();
  let body: z.infer<typeof bodySchema>;
  try {
    body = await parseBody(request, bodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }

  const embed = extractEmbed(body.embedCode);
  if (!embed) return NextResponse.json({ error: "Could not find a form id in that embed code." }, { status: 400 });

  let slug = slugify(body.name);
  const clash = await db.select({ id: customFilloutForms.id }).from(customFilloutForms).where(eq(customFilloutForms.slug, slug)).limit(1);
  if (clash.length > 0) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const [row] = await db
    .insert(customFilloutForms)
    .values({
      slug,
      name: body.name.trim(),
      blurb: body.blurb?.trim() ?? "",
      template: body.template ?? "General",
      embedId: embed.embedId,
      embedKind: embed.embedKind,
      height: body.height ?? 500,
      icon: body.icon?.trim() || "▤",
      active: true,
    })
    .returning();

  return NextResponse.json({ ok: true, form: row });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.update(customFilloutForms).set({ active: false }).where(eq(customFilloutForms.id, id));
  return NextResponse.json({ ok: true });
}
