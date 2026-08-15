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
