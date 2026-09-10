import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";

export class ValidationError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
  }
}

function truncate(text: string, max = 600): string {
  return text.length > max ? `${text.slice(0, max)}…(${text.length} chars)` : text;
}

/** Parse and validate a request body against a zod schema, or throw ValidationError. */
export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  const raw = await request.text().catch(() => "");
  let json: unknown;
  try {
    json = raw ? JSON.parse(raw) : undefined;
  } catch {
    console.warn(`[api] 400 invalid JSON body: ${truncate(raw)}`);
    throw new ValidationError(["Request body must be valid JSON"]);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
    console.warn(`[api] 400 validation: ${issues.join("; ")} — body: ${truncate(JSON.stringify(json) ?? "")}`);
    throw new ValidationError(issues);
  }
  return result.data;
}

export function validationErrorResponse(error: ValidationError): NextResponse {
  return NextResponse.json({ error: "Invalid request body", details: error.issues }, { status: 400 });
}
