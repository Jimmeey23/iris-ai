import { getOpenAiKey } from "./settings";
import { recordAiCall } from "./telemetry";

/**
 * Embeddings for semantic context retrieval (related tickets, similar reports).
 * Cheap (text-embedding-3-small), batched, and null-safe: every caller must
 * degrade to the token-overlap path when this returns null.
 */

const MODEL = "text-embedding-3-small";
const MAX_BATCH = 120;

export async function embed(texts: string[]): Promise<number[][] | null> {
  const key = await getOpenAiKey();
  if (!key.startsWith("sk-") || texts.length === 0) return null;
  const started = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        input: texts.slice(0, MAX_BATCH).map((t) => t.slice(0, 4000)),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`http-${res.status}`);
    const json = (await res.json()) as {
      data?: { index: number; embedding: number[] }[];
      usage?: { prompt_tokens?: number };
    };
    const out = [...(json.data ?? [])]
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
    if (out.length !== Math.min(texts.length, MAX_BATCH)) throw new Error("embedding-count-mismatch");
    void recordAiCall({
      feature: "embeddings",
      model: MODEL,
      ok: true,
      latencyMs: Date.now() - started,
      inputTokens: json.usage?.prompt_tokens,
    });
    return out;
  } catch (err) {
    void recordAiCall({
      feature: "embeddings",
      model: MODEL,
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 120) : "exception",
      latencyMs: Date.now() - started,
    });
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
