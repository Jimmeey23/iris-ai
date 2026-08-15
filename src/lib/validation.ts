import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";

export class ValidationError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
  }
}

/** Parse and validate a request body against a zod schema, or throw ValidationError. */
export async function parseBody<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  const json = await request.json().catch(() => {
    throw new ValidationError(["Request body must be valid JSON"]);
  });
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`));
  }
  return result.data;
}

export function validationErrorResponse(error: ValidationError): NextResponse {
  return NextResponse.json({ error: "Invalid request body", details: error.issues }, { status: 400 });
}
