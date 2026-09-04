export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Resolve to an absolute URL. Some browser extensions monkey-patch `window.fetch`
 * and crash on relative paths (they call `new URL(input)` with no base) — passing
 * an absolute URL sidesteps that without depending on the extension being fixed.
 */
function toAbsoluteUrl(url: string): string {
  if (typeof window === "undefined" || /^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return new URL(url, window.location.origin).toString();
}

/** Fetch JSON from an API route, throwing ApiError with the server's error message on failure. */
export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(toAbsoluteUrl(url), init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (json as { error?: string })?.error || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return json as T;
}

export function apiPost<T = unknown>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ */
/* Server-sent events                                                  */
/* ------------------------------------------------------------------ */

export type SseHandlers = Record<string, (data: unknown) => void>;

/**
 * POST a JSON body and consume a server-sent-events response.
 *
 * `EventSource` cannot POST, so this reads the stream by hand. Handlers are
 * keyed by event name; unknown events are ignored so the server can add new
 * ones without breaking older clients.
 */
export async function apiPostStream(
  url: string,
  body: unknown,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(toAbsoluteUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const message = await res.text().catch(() => "");
    throw new ApiError(message || `Request failed (${res.status})`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line.
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) {
        try {
          handlers[event]?.(JSON.parse(dataLines.join("\n")));
        } catch {
          // A malformed frame is not worth killing the stream over.
        }
      }
      split = buffer.indexOf("\n\n");
    }
  }
}
