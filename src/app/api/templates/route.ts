import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customTemplates } from "@/db/schema";
import { ensureSeeded } from "@/lib/seed";
import { TAXONOMY } from "@/lib/taxonomy";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  const rows = await db
    .select()
    .from(customTemplates)
    .where(eq(customTemplates.active, true))
    .orderBy(asc(customTemplates.name));
  return NextResponse.json({ templates: rows });
}

type Field = {
  kind: string;
  label: string;
  name: string;
  options?: string[];
  placeholder?: string;
  helper?: string;
  required?: boolean;
};

type Body = {
  name: string;
  blurb?: string;
  icon?: string;
  group?: string;
  category: string;
  subcategory: string;
  priority?: string;
  raisedFor?: string;
  kind?: "form" | "embed";
  embedId?: string;
  embedKind?: "fillout-v1" | "zite-v2";
  embedHeight?: number;
  fields?: Field[];
  createdBy?: string;
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

const fieldSchema = z.object({
  kind: z.string(),
  label: z.string(),
  name: z.string(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  helper: z.string().optional(),
  required: z.boolean().optional(),
});

const bodySchema = z.object({
  name: z.string().min(1),
  blurb: z.string().optional(),
  icon: z.string().optional(),
  group: z.string().optional(),
  category: z.string().min(1),
  subcategory: z.string().min(1),
  priority: z.string().optional(),
  raisedFor: z.string().optional(),
  kind: z.enum(["form", "embed"]).optional(),
  embedId: z.string().optional(),
  embedKind: z.enum(["fillout-v1", "zite-v2"]).optional(),
  embedHeight: z.number().optional(),
  fields: z.array(fieldSchema).optional(),
  createdBy: z.string().optional(),
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

  if (!body.name?.trim()) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (!body.category || !TAXONOMY[body.category]) {
    return NextResponse.json({ error: "Pick a valid category." }, { status: 400 });
  }
  const subs = TAXONOMY[body.category];
  const subcategory = subs.includes(body.subcategory) ? body.subcategory : subs[0];

  const kind = body.kind ?? "form";
  if (kind === "embed" && !body.embedId?.trim()) {
    return NextResponse.json({ error: "Paste the Fillout embed ID or snippet." }, { status: 400 });
  }
  if (kind === "form" && (body.fields?.length ?? 0) === 0) {
    return NextResponse.json({ error: "Add at least one field." }, { status: 400 });
  }

  let slug = slugify(body.name);
  const clash = await db.select({ id: customTemplates.id }).from(customTemplates).where(eq(customTemplates.slug, slug)).limit(1);
  if (clash.length > 0) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

  const [row] = await db
    .insert(customTemplates)
    .values({
      slug,
      name: body.name.trim(),
      blurb: body.blurb?.trim() ?? "",
      icon: body.icon?.trim() || "▤",
      group: body.group ?? "Facilities",
      category: body.category,
      subcategory,
      priority: body.priority ?? "Medium",
      raisedFor: body.raisedFor ?? "Noticed by staff",
      kind,
      embedId: body.embedId?.trim() ?? null,
      embedKind: body.embedKind ?? null,
      embedHeight: body.embedHeight ?? 600,
      fields: (body.fields ?? []) as unknown as Record<string, unknown>[],
      createdBy: body.createdBy ?? "",
      active: true,
    })
    .returning();

  return NextResponse.json({ ok: true, template: row });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.update(customTemplates).set({ active: false }).where(eq(customTemplates.id, id));
  return NextResponse.json({ ok: true });
}
