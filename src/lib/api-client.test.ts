import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiPostStream } from "./api-client";

/**
 * Encodes frames exactly the way `/api/chat/stream` does, so this exercises the
 * real wire format rather than a convenient approximation.
 */
function sseResponse(frames: { event: string; data: unknown }[], chunkSize = 7): Response {
  const text = frames
    .map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`)
    .join("");
  const bytes = new TextEncoder().encode(text);
  let offset = 0;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });

  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiPostStream", () => {
  it("dispatches events in order, even when frames are split across chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { event: "status", data: { status: "Reading your report" } },
          { event: "reply", data: { text: "Got it — " } },
          { event: "reply", data: { text: "on the AC now." } },
          { event: "done", data: { sessionId: "s1", step: "review" } },
        ]),
      ),
    );

    const seen: string[] = [];
    let reply = "";
    let done: unknown = null;

    await apiPostStream("/api/chat/stream", { hello: true }, {
      status: (d) => seen.push(`status:${(d as { status: string }).status}`),
      reply: (d) => {
        reply += (d as { text: string }).text;
      },
      done: (d) => {
        done = d;
      },
    });

    expect(seen).toEqual(["status:Reading your report"]);
    expect(reply).toBe("Got it — on the AC now.");
    expect(done).toEqual({ sessionId: "s1", step: "review" });
  });

  it("ignores events it has no handler for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { event: "some_future_event", data: { x: 1 } },
          { event: "done", data: { ok: true } },
        ]),
      ),
    );

    let done = false;
    await expect(
      apiPostStream("/api/chat/stream", {}, { done: () => { done = true; } }),
    ).resolves.toBeUndefined();
    expect(done).toBe(true);
  });

  it("throws ApiError when the server rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    );
    await expect(apiPostStream("/api/chat/stream", {}, {})).rejects.toMatchObject({ status: 401 });
  });
});


it("resolves profile URLs before an extension parses them without a base", async () => {
  vi.stubGlobal("window", { location: { origin: "http://localhost:3000" } });
  const intercepted = vi.fn(async (url: string) => {
    expect(new URL(url).pathname).toBe("/api/auth/me");
    return Response.json({ user: { name: "Jimmeey" } });
  });
  vi.stubGlobal("fetch", intercepted);
  await expect(apiFetch("/api/auth/me")).resolves.toEqual({ user: { name: "Jimmeey" } });
  expect(intercepted).toHaveBeenCalledWith("http://localhost:3000/api/auth/me", undefined);
});
