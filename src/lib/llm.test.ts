import { describe, expect, it } from "vitest";
import { createFieldStreamer } from "./llm";

/** Feed a document to the streamer one character at a time, as SSE would. */
function drip(doc: string, field = "reply"): string {
  const read = createFieldStreamer(field);
  let buffer = "";
  let out = "";
  for (const ch of doc) {
    buffer += ch;
    out += read(buffer);
  }
  return out;
}

describe("createFieldStreamer", () => {
  it("reveals a field as it is written", () => {
    expect(drip('{"reply": "Got it, on the AC now.", "readyForDraft": true}')).toBe(
      "Got it, on the AC now.",
    );
  });

  it("emits nothing before the field appears", () => {
    const read = createFieldStreamer("reply");
    expect(read('{"classification": {"category": "Repair')).toBe("");
  });

  it("decodes escapes split across chunks", () => {
    expect(drip('{"reply": "Line one\\nLine \\"two\\"", "x": 1}')).toBe('Line one\nLine "two"');
  });

  it("decodes unicode escapes", () => {
    expect(drip('{"reply": "\\u20b912,000 charged twice"}')).toBe("₹12,000 charged twice");
  });

  it("stops at the end of the field and ignores later fields", () => {
    expect(drip('{"reply": "done", "summary": "not this"}')).toBe("done");
  });

  it("never emits the same text twice", () => {
    const read = createFieldStreamer("reply");
    const doc = '{"reply": "hello there"}';
    let buffer = "";
    const pieces: string[] = [];
    for (const ch of doc) {
      buffer += ch;
      const piece = read(buffer);
      if (piece) pieces.push(piece);
    }
    expect(pieces.join("")).toBe("hello there");
    expect(read(doc)).toBe("");
  });
});
