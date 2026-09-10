/**
 * Best-effort in-process rate limiting for expensive endpoints (chat turns run
 * up to several model calls each). Single-instance only — a ceiling, not a
 * security boundary.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 5000;

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || now - v[v.length - 1] >= windowMs) buckets.delete(k);
      if (buckets.size <= MAX_KEYS) break;
    }
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Key a request by its forwarded client IP, falling back to a shared bucket. */
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "local";
}
