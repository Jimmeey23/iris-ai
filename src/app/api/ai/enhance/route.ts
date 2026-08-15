import { NextResponse } from "next/server";
import { z } from "zod";
import { getOpenAiKey, getSetting } from "@/lib/settings";
import { classify } from "@/lib/ai";
import { CATEGORY_META } from "@/lib/taxonomy";
import { ValidationError, parseBody, validationErrorResponse } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Body = { text: string; context?: Record<string, string | number | null | undefined> };

const bodySchema = z.object({
  text: z.string(),
  context: z.record(z.string(), z.union([z.string(), z.number(), z.null()]).optional()).optional(),
});

const FILLERS = /\b(um+|uh+|like|basically|kinda|sorta|you know|i mean|just saying|sort of|kind of)\b/gi;

const SPELLING: [RegExp, string][] = [
  [/\bworkin\b/gi, "working"], [/\bcomin\b/gi, "coming"], [/\bgoin\b/gi, "going"],
  [/\bhavin\b/gi, "having"], [/\bdoin\b/gi, "doing"], [/\bnothin\b/gi, "nothing"],
  [/\bn\b/g, "and"], [/\bu\b/gi, "you"], [/\br\b/gi, "are"], [/\bpls\b/gi, "please"],
  [/\bthx\b/gi, "thanks"], [/\basap\b/gi, "as soon as possible"], [/\bfyi\b/gi, "for information"],
  [/\btmrw\b/gi, "tomorrow"], [/\btdy\b/gi, "today"], [/\byday\b/gi, "yesterday"],
  [/\bmbr\b/gi, "member"], [/\bcust\b/gi, "customer"], [/\bmngr\b/gi, "manager"],
  [/\bagn\b/gi, "again"], [/\bppl\b/gi, "people"], [/\bppl's\b/gi, "people's"],
  [/\bmins\b/gi, "minutes"], [/\bhrs\b/gi, "hours"], [/\bsesh\b/gi, "session"],
  [/\bbcoz\b/gi, "because"], [/\bcuz\b/gi, "because"], [/\bb4\b/gi, "before"],
  [/\brepl\b/gi, "replacement"], [/\bnt\b/gi, "not"], [/\bgd\b/gi, "good"],
  [/\bdont\b/gi, "don't"], [/\bcant\b/gi, "can't"], [/\bwont\b/gi, "won't"],
  [/\bwasnt\b/gi, "wasn't"], [/\bdidnt\b/gi, "didn't"], [/\bisnt\b/gi, "isn't"],
  [/\bhasnt\b/gi, "hasn't"], [/\bcouldnt\b/gi, "couldn't"], [/\bshouldnt\b/gi, "shouldn't"],
  [/\btheres\b/gi, "there's"], [/\bits broken\b/gi, "it's broken"],
];

const CAPS: [RegExp, string][] = [
  [/\bac\b/gi, "AC"], [/\bhvac\b/gi, "HVAC"], [/\bwi-?fi\b/gi, "Wi-Fi"],
  [/\bpos\b/gi, "POS"], [/\bcctv\b/gi, "CCTV"], [/\bcrm\b/gi, "CRM"],
  [/\bmomence\b/gi, "Momence"], [/\brazorpay\b/gi, "Razorpay"], [/\bstripe\b/gi, "Stripe"],
  [/\bipad\b/gi, "iPad"], [/\bbarre\b/gi, "Barre"], [/\bpowercycle\b/gi, "powerCycle"],
];

/** Deterministic clean-up used when no OpenAI key is configured. */
function localEnhance(text: string, context: Record<string, unknown>): { out: string; changes: string[] } {
  const changes: string[] = [];
  let out = text.trim();

  if (FILLERS.test(out)) {
    out = out.replace(FILLERS, "");
    changes.push("removed filler");
  }
  let spellingFixed = false;
  for (const [re, to] of SPELLING) {
    if (re.test(out)) {
      out = out.replace(re, to);
      spellingFixed = true;
    }
  }
  if (spellingFixed) changes.push("expanded shorthand");

  for (const [re, to] of CAPS) out = out.replace(re, to);

  out = out.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  out = out.replace(/\bi\b/g, "I");

  // Split run-on clauses joined by commas into proper sentences.
  const sentences = out
    .split(/(?<=[.!?])\s+/)
    .flatMap((chunk) => (chunk.length > 130 ? chunk.split(/,\s+(?=(?:and |but |so |the |a )?[a-z])/i) : [chunk]))
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => c.charAt(0).toUpperCase() + c.slice(1))
    .map((c) => (/[.!?]$/.test(c) ? c : `${c}.`));
  if (sentences.length > 1) changes.push("split into sentences");
  out = sentences.join(" ");

  // Append any structured context that isn't already stated.
  const bits: string[] = [];
  const lower = out.toLowerCase();
  const add = (label: string, v?: unknown) => {
    const val = v ? String(v) : "";
    if (val && !lower.includes(val.split(",")[0].toLowerCase())) bits.push(`${label} ${val}`);
  };
  add("Studio:", context.studioName);
  add("Member:", context.memberName);
  add("Trainer:", context.trainerName);
  add("Class:", context.classInfo);
  if (bits.length) {
    out += ` ${bits.join(". ")}.`;
    changes.push("added known context");
  }

  return { out, changes: changes.slice(0, 3) };
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await parseBody(request, bodySchema);
  } catch (err) {
    if (err instanceof ValidationError) return validationErrorResponse(err);
    throw err;
  }
  const text = (body.text ?? "").trim();
  if (text.length < 3) {
    return NextResponse.json({ ok: false, error: "Write a little more first." }, { status: 400 });
  }

  const context = (body.context ?? {}) as Record<string, unknown>;
  const guess = classify(text, 1)[0];
  const hint = guess ? `${guess.category} › ${guess.subcategory}` : "an operational issue";

  const key = await getOpenAiKey();
  if (!key.startsWith("sk-")) {
    const local = localEnhance(text, context);
    return NextResponse.json({
      ok: true,
      enhanced: local.out,
      changes: local.changes,
      engine: "Iris cleanup (on-device)",
      hint,
    });
  }

  const model = (await getSetting("openai_model")) || "gpt-4o-mini";
  const tone = (await getSetting("ai_tone")) || "warm";
  const knownBits = Object.entries(context)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 240,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You rewrite short internal issue reports for Physique 57, a boutique barre studio group in India.",
              "Return JSON {\"enhanced\": string, \"changes\": string[]}.",
              "enhanced: the same report rewritten so it is clear, specific, factual and complete — 1 to 3 sentences.",
              "Keep every concrete fact. Never invent details, names, times or numbers that are not present.",
              "Fix grammar, expand abbreviations, remove filler, and lead with the core problem.",
              `Tone: ${tone === "formal" ? "professional and procedural" : tone === "concise" ? "tight and factual" : "clear and natural"}.`,
              "changes: up to 3 very short notes on what you improved.",
              "Use British English.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Report: "${text}"\nLikely classification: ${hint}\nKnown context: ${knownBits || "none"}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) throw new Error("openai");
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as {
      enhanced?: string;
      changes?: string[];
    };
    if (!parsed.enhanced?.trim()) throw new Error("empty");
    return NextResponse.json({
      ok: true,
      enhanced: parsed.enhanced.trim(),
      changes: parsed.changes?.slice(0, 3) ?? [],
      engine: `OpenAI ${model}`,
      hint,
      category: guess?.category,
      icon: guess ? CATEGORY_META[guess.category]?.icon : undefined,
    });
  } catch {
    const local = localEnhance(text, context);
    return NextResponse.json({
      ok: true,
      enhanced: local.out,
      changes: local.changes,
      engine: "Iris cleanup (fallback)",
      hint,
    });
  }
}
