import { getOpenAiKey, getSetting } from "./settings";
import { recordAiCall } from "./telemetry";

/**
 * The single OpenAI client every AI path in the app goes through.
 *
 * One place owns retries, timeouts, JSON parsing, telemetry and model selection,
 * so behaviour cannot drift per feature. Two tiers so we never pay frontier
 * prices for cosmetic work:
 *  - "reason"  → classification, extraction, question planning, enrichment
 *  - "fast"    → wording touch-ups and compression where a mistake costs nothing
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
  /** Telemetry bucket, e.g. "intake" | "triage" | "copy" | "narrative". */
  feature?: string;
  /** Chat session id, for joining telemetry to conversations. */
  sessionId?: string;
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

type Usage = { inputTokens?: number; outputTokens?: number };

function usageOf(json: unknown): Usage {
  const u = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  return {
    inputTokens: typeof u?.prompt_tokens === "number" ? u.prompt_tokens : undefined,
    outputTokens: typeof u?.completion_tokens === "number" ? u.completion_tokens : undefined,
  };
}

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
  let usage: Usage | undefined;

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
      usage = usageOf(json);
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        lastError = "empty-response";
        continue;
      }
      const latencyMs = Date.now() - started;
      void recordAiCall({
        feature: call.feature ?? "unknown",
        model,
        ok: true,
        latencyMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        sessionId: call.sessionId,
      });
      return {
        ok: true,
        data: JSON.parse(content) as T,
        model,
        latencyMs,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.name : "exception";
      if (attempt < attempts - 1) await wait(null, attempt);
    }
  }
  void recordAiCall({
    feature: call.feature ?? "unknown",
    model,
    ok: false,
    error: lastError,
    latencyMs: Date.now() - started,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    sessionId: call.sessionId,
  });
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
 * streaming fails (the fallback logs its own telemetry, so only successes are
 * recorded here).
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

    const latencyMs = Date.now() - started;
    void recordAiCall({
      feature: call.feature ?? "unknown",
      model,
      ok: true,
      latencyMs,
      sessionId: call.sessionId,
    });
    return { ok: true, data: JSON.parse(content) as T, model, latencyMs };
  } catch {
    // Streaming is an optimisation, never a dependency.
    return chatJson<T>(call);
  }
}

/* ------------------------------------------------------------------ */
/* Prose                                                               */
/* ------------------------------------------------------------------ */

export type LlmTextResult = LlmResult<string>;

/**
 * Plain prose completion for narrative surfaces (briefings, narratives) that
 * have no use for JSON mode. Never throws.
 */
export async function chatText(call: LlmCall): Promise<LlmTextResult> {
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
          temperature: call.temperature ?? 0.3,
          max_tokens: call.maxTokens ?? 400,
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: call.user },
          ],
        }),
        signal: AbortSignal.timeout(call.timeoutMs ?? 20000),
      });
      if (!res.ok) {
        lastError = `http-${res.status}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
        if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        lastError = "empty-response";
        continue;
      }
      const latencyMs = Date.now() - started;
      void recordAiCall({
        feature: call.feature ?? "unknown",
        model,
        ok: true,
        latencyMs,
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
        sessionId: call.sessionId,
      });
      return { ok: true, data: content, model, latencyMs };
    } catch (err) {
      lastError = err instanceof Error ? err.name : "exception";
      if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  void recordAiCall({
    feature: call.feature ?? "unknown",
    model,
    ok: false,
    error: lastError,
    latencyMs: Date.now() - started,
    sessionId: call.sessionId,
  });
  return { ok: false, error: lastError, model, latencyMs: Date.now() - started };
}

/* ------------------------------------------------------------------ */
/* Native tool calling                                                 */
/* ------------------------------------------------------------------ */

/**
 * A message in an OpenAI tool-calling conversation. Tool results come back as
 * their own role, addressed to the call that produced them, so the model sees a
 * genuine transcript of its own investigation rather than facts pasted into a
 * prompt by us.
 */
export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: RawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type RawToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolTurnResult = {
  ok: boolean;
  /** Prose the model wrote outside any tool call. */
  content?: string;
  toolCalls: RawToolCall[];
  model?: string;
  error?: string;
  latencyMs: number;
};

/**
 * One step of a tool-calling loop: send the conversation so far, get back
 * either prose, one or more tool calls, or both.
 *
 * Streams so a terminal tool's `reply` argument can reach the reporter while
 * the rest of the arguments are still being written — `streamField` names the
 * argument to surface and `onFieldDelta` receives it.
 */
export async function chatWithTools(call: {
  messages: LlmMessage[];
  tools: LlmToolDef[];
  /** "required" forces a tool call — used to make the model land the turn. */
  toolChoice?: "auto" | "required";
  tier?: ModelTier;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  feature?: string;
  sessionId?: string;
  streamField?: string;
  onFieldDelta?: (text: string) => void;
}): Promise<ToolTurnResult> {
  const started = Date.now();
  const key = await getOpenAiKey();
  if (!key.startsWith("sk-")) return { ok: false, toolCalls: [], error: "no-api-key", latencyMs: 0 };
  const model = await modelFor(call.tier ?? "reason");

  const body = {
    model,
    temperature: call.temperature ?? 0.2,
    max_tokens: call.maxTokens ?? 2200,
    tools: call.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    tool_choice: call.toolChoice ?? "auto",
    parallel_tool_calls: true,
    stream: true,
    messages: call.messages,
  };

  const finish = (result: ToolTurnResult): ToolTurnResult => {
    void recordAiCall({
      feature: call.feature ?? "agent",
      model,
      ok: result.ok,
      error: result.error,
      latencyMs: result.latencyMs,
      sessionId: call.sessionId,
    });
    return result;
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(call.timeoutMs ?? 60000),
    });
    if (!res.ok || !res.body) {
      return finish({ ok: false, toolCalls: [], error: `http-${res.status}`, model, latencyMs: Date.now() - started });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const streamer = call.streamField ? createFieldStreamer(call.streamField) : null;
    // Tool calls stream in fragments identified by index, not by id.
    const partial = new Map<number, { id: string; name: string; args: string }>();
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
            choices?: {
              delta?: {
                content?: string;
                tool_calls?: {
                  index: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }[];
              };
            }[];
          };
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) content += delta.content;
          for (const tc of delta?.tool_calls ?? []) {
            const slot = partial.get(tc.index) ?? { id: "", name: "", args: "" };
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name = tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
            partial.set(tc.index, slot);
            // Surface the reply as it is written, from the first call only.
            if (streamer && tc.index === 0 && call.onFieldDelta) {
              const fresh = streamer(slot.args);
              if (fresh) call.onFieldDelta(fresh);
            }
          }
        } catch {
          // A partial SSE frame — the next chunk completes it.
        }
      }
    }

    const toolCalls: RawToolCall[] = [...partial.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, slot]) => ({
        id: slot.id || `call_${index}`,
        type: "function" as const,
        function: { name: slot.name, arguments: slot.args || "{}" },
      }))
      .filter((t) => t.function.name);

    return finish({ ok: true, content, toolCalls, model, latencyMs: Date.now() - started });
  } catch (err) {
    return finish({
      ok: false,
      toolCalls: [],
      error: err instanceof Error ? err.name : "exception",
      model,
      latencyMs: Date.now() - started,
    });
  }
}
