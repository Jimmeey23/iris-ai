import { getOpenAiKey, getSetting } from "./settings";

/**
 * Thin OpenAI JSON wrapper used by every AI path in the app.
 *
 * Two tiers so we never pay frontier prices for cosmetic work:
 *  - "reason"  → classification, extraction, question planning, enrichment
 *  - "fast"    → wording touch-ups where a mistake costs nothing
 */
export type ModelTier = "reason" | "fast";

const DEFAULT_REASON_MODEL = "gpt-4.1";
const DEFAULT_FAST_MODEL = "gpt-4.1-mini";

export async function modelFor(tier: ModelTier): Promise<string> {
  if (tier === "fast") {
    return (
      (await getSetting("openai_model_fast")) ||
      process.env.OPENAI_MODEL_FAST ||
      DEFAULT_FAST_MODEL
    );
  }
  return (await getSetting("openai_model")) || process.env.OPENAI_MODEL || DEFAULT_REASON_MODEL;
}

export async function llmAvailable(): Promise<boolean> {
  const key = await getOpenAiKey();
  return key.startsWith("sk-");
}

export type LlmCall = {
  system: string;
  user: string;
  tier?: ModelTier;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Retried once on transport failure or unparseable JSON. */
  retries?: number;
};

export type LlmResult<T> = {
  ok: boolean;
  data?: T;
  model?: string;
  error?: string;
  latencyMs: number;
};

/** Single JSON-mode chat completion. Never throws — callers branch on `ok`. */
export async function chatJson<T>(call: LlmCall): Promise<LlmResult<T>> {
  const started = Date.now();
  const key = await getOpenAiKey();
  if (!key.startsWith("sk-")) {
    return { ok: false, error: "no-api-key", latencyMs: 0 };
  }
  const model = await modelFor(call.tier ?? "reason");
  const attempts = (call.retries ?? 1) + 1;
  let lastError = "unknown";

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: call.temperature ?? 0.2,
          max_tokens: call.maxTokens ?? 1400,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: call.user },
          ],
        }),
        signal: AbortSignal.timeout(call.timeoutMs ?? 25000),
      });
      if (!res.ok) {
        lastError = `http-${res.status}`;
        // Client errors will not fix themselves on retry.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        continue;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        lastError = "empty-response";
        continue;
      }
      return {
        ok: true,
        data: JSON.parse(content) as T,
        model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.name : "exception";
    }
  }
  return { ok: false, error: lastError, model, latencyMs: Date.now() - started };
}
