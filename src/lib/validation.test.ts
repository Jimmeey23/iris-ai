import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError, parseBody, validationErrorResponse } from "./validation";

const schema = z.object({ category: z.string().min(1), count: z.number().optional() });

describe("parseBody", () => {
  it("returns the parsed data when the body matches the schema", async () => {
    const request = new Request("http://test/", {
      method: "POST",
      body: JSON.stringify({ category: "Facilities", count: 3 }),
    });
    const body = await parseBody(request, schema);
    expect(body).toEqual({ category: "Facilities", count: 3 });
  });

  it("throws ValidationError when a required field is missing", async () => {
    const request = new Request("http://test/", { method: "POST", body: JSON.stringify({}) });
    await expect(parseBody(request, schema)).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when the body is not valid JSON", async () => {
    const request = new Request("http://test/", { method: "POST", body: "not json" });
    await expect(parseBody(request, schema)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("validationErrorResponse", () => {
  it("produces a 400 response carrying the issue list", async () => {
    const err = new ValidationError(["category: Required"]);
    const res = validationErrorResponse(err);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details).toEqual(["category: Required"]);
  });
});
