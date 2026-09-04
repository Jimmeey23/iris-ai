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
  /** Strict JSON Schema for model output. Falls back to JSON object mode when omitted. */
  responseSchema?: { name: string; schema: Record<string, unknown> };
};

function responseFormat(call: LlmCall): Record<string, unknown> {
  if (!call.responseSchema) return { type: "json_object" };
  return {
    type: "json_schema",
    json_schema: {
      name: call.responseSchema.name,
      // Some agent fields intentionally use dynamic keys (slots and extra
      // details), so the schema guides generation while runtime validation
      // below remains the final authority.
      strict: false,
      schema: call.responseSchema.schema,
    },
  };
}

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
  const attempts = (call.retries ?? 2) + 1;
  let lastError = "unknown";

  /** Honour Retry-After when the API sends it, else back off exponentially. */
  const wait = async (res: Response | null, attempt: number) => {
    const header = Number(res?.headers.get("retry-after"));
    const ms = Number.isFinite(header) && header > 0
      ? Math.min(header * 1000, 20000)
      : Math.min(1000 * 2 ** attempt, 8000);
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: call.temperature ?? 0.2,
          max_tokens: call.maxTokens ?? 1400,
          response_format: responseFormat(call),
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: call.user },
          ],
        }),
        signal: AbortSignal.timeout(call.timeoutMs ?? 25000),
      });
      if (!res.ok) {
        lastError = `http-${res.status}`;
        // Client errors will not fix themselves on retry; rate limits will.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        if (attempt < attempts - 1) await wait(res, attempt);
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
      if (attempt < attempts - 1) await wait(null, attempt);
    }
  }
  return { ok: false, error: lastError, model, latencyMs: Date.now() - started };
}

/* ------------------------------------------------------------------ */
/* Streaming                                                           */
/* ------------------------------------------------------------------ */

/**
 * Incrementally pulls one string field out of a JSON document that is still
 * being written.
 *
 * The agent's schema puts "reply" first precisely so the reporter can start
 * reading it while the rest of the analysis is still generating. This decodes
 * the escapes it has seen so far and reports only the newly revealed text.
 */
export function createFieldStreamer(field: string) {
  const opener = `"${field}"`;
  let emitted = 0;
  let done = false;

  return function read(buffer: string): string {
    if (done) return "";
    const keyAt = buffer.indexOf(opener);
    if (keyAt === -1) return "";
    const colon = buffer.indexOf(":", keyAt + opener.length);
    if (colon === -1) return "";
    const quote = buffer.indexOf('"', colon + 1);
    if (quote === -1) return "";

    let out = "";
    let complete = false;
    for (let i = quote + 1; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch === "\\") {
        // An escape split across chunks: stop and pick it up next time.
        if (i + 1 >= buffer.length) break;
        const esc = buffer[i + 1];
        const map: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/" };
        if (esc === "u") {
          if (i + 5 >= buffer.length) break;
          out += String.fromCharCode(parseInt(buffer.slice(i + 2, i + 6), 16));
          i += 5;
        } else {
          out += map[esc] ?? esc;
          i += 1;
        }
        continue;
      }
      if (ch === '"') {
        complete = true;
        break;
      }
      out += ch;
    }

    const fresh = out.slice(emitted);
    emitted = out.length;
    if (complete) done = true;
    return fresh;
  };
}

export type StreamingCall = LlmCall & {
  /** Called with each newly revealed slice of the named field. */
  onFieldDelta?: (text: string) => void;
  /** Which top-level string field to stream. Defaults to "reply". */
  streamField?: string;
};

/**
 * Same contract as `chatJson`, but the response is streamed so the caller can
 * surface prose while the model is still writing. Falls back to a plain call if
 * streaming fails.
 */
export async function chatJsonStreaming<T>(call: StreamingCall): Promise<LlmResult<T>> {
  const started = Date.now();
  const key = await getOpenAiKey();
  if (!key.startsWith("sk-")) return { ok: false, error: "no-api-key", latencyMs: 0 };
  const model = await modelFor(call.tier ?? "reason");
  const streamer = createFieldStreamer(call.streamField ?? "reply");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: call.temperature ?? 0.2,
        max_tokens: call.maxTokens ?? 1400,
        response_format: responseFormat(call),
        stream: true,
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: call.user },
        ],
      }),
      signal: AbortSignal.timeout(call.timeoutMs ?? 45000),
    });
    if (!res.ok || !res.body) throw new Error(`http-${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";
    let content = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const piece = chunk.choices?.[0]?.delta?.content;
          if (!piece) continue;
          content += piece;
          const fresh = streamer(content);
          if (fresh && call.onFieldDelta) call.onFieldDelta(fresh);
        } catch {
          // A partial SSE frame — the next chunk completes it.
        }
      }
    }

    return { ok: true, data: JSON.parse(content) as T, model, latencyMs: Date.now() - started };
  } catch {
    // Streaming is an optimisation, never a dependency.
    return chatJson<T>(call);
  }
}
