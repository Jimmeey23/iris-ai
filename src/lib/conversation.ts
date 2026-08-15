import type { IntakeData } from "./chat-engine";
import type { SlotId } from "./dynamic-chat";
import { getOpenAiKey, getSetting } from "./settings";

/* ------------------------------------------------------------------ */
/* Conversational voice — warm, brief, human                           */
/* ------------------------------------------------------------------ */

function pick<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function timeGreeting(): string {
  const h = Number(
    new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }),
  );
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

/** Short empathetic reaction to what was just described. */
export function reactTo(text: string, sentiment: string, category: string): string {
  const t = text.toLowerCase();
  if (/injur|hurt|slip|fell|bleed|faint|collaps|ambulance|emergency/.test(t)) {
    return "That's a safety one — let's get it logged properly and fast.";
  }
  if (/harass|assault|threat|inappropriate/.test(t)) {
    return "Thanks for flagging this. I'll treat it as confidential and route it straight to leadership.";
  }
  if (/stolen|theft|missing|lost/.test(t)) {
    return "Not what we want to hear — let's capture the details while they're fresh.";
  }
  if (/refund|charged twice|double charge|cancel|chargeback/.test(t)) {
    return "Billing frustrations escalate fast, so let's get this to Accounts cleanly.";
  }
  if (/not cooling|too hot|too cold|ac |hvac|air ?con|temperature/.test(t)) {
    return "Comfort faults empty a room fast — let's get facilities on it.";
  }
  if (/broken|not working|damaged|faulty|wobbl|loose|cracked/.test(t)) {
    return "Let's get that logged before someone gets hurt.";
  }
  if (/dirty|smell|odour|unclean|mould|mold|filthy|bin/.test(t)) {
    return "Cleanliness is the first thing members notice — noted.";
  }
  if (/late|delay|no.?show|didn'?t turn up|waiting/.test(t)) {
    return "Timing slips hit member trust — let's capture it.";
  }
  if (/wifi|internet|momence|pos|system down|app crash|not syncing/.test(t)) {
    return "Platform problems block the whole floor — let's get IT the detail.";
  }
  if (/crowd|packed|full|no space|overbook/.test(t)) {
    return "Capacity issues are usually a booking-rule fix — let's log it.";
  }
  if (sentiment === "Escalated") return "Understood — this one needs urgency. Let's move quickly.";
  if (sentiment === "Positive") return "Lovely — good feedback deserves to be recorded too.";
  if (sentiment === "Negative") return "Got it, that's frustrating for the member.";
  if (category === "Scheduling") return "Timetable demand signals are useful — let's log it.";
  return "Got it, thanks.";
}

const ACKS = [
  "Perfect.",
  "Great, noted.",
  "Thanks.",
  "Got it.",
  "Noted.",
  "That helps.",
  "Understood.",
  "Logged.",
];

/** Small acknowledgement that varies so it never feels robotic. */
export function ack(slot: string, value?: string): string {
  const base = pick(ACKS, hash(slot + (value ?? "")));
  if (!value) return base;
  switch (slot) {
    case "member":
      return value === "Anonymous member"
        ? `${base} Keeping them anonymous.`
        : `${base} I've pulled ${value} onto the ticket.`;
    case "trainer":
      return `${base} Flagging ${value} on this.`;
    case "classInfo":
      return `${base} Linked to ${value}.`;
    case "studio":
      return `${base} ${value.split(",")[0]} it is.`;
    case "impact":
      return value.includes("Safety") ? "That raises the severity — noted." : base;
    case "atRisk":
      return value === "true" ? "Understood, treating this as urgent." : `${base} Good to know nobody's at risk.`;
    default:
      return base;
  }
}

/** Encouraging progress note as the form fills up. */
export function progressNote(remaining: number): string | null {
  if (remaining === 0) return "That's everything I need — building your draft now.";
  if (remaining === 1) return "One last thing.";
  if (remaining === 2) return "Almost there, two quick ones.";
  if (remaining <= 4) return `Just ${remaining} more and we're done.`;
  return null;
}

/** Explain, in plain language, why a question is being asked. */
export const WHY: Partial<Record<SlotId, string>> = {
  studio: "so it routes to the right studio owner",
  raisedFor: "it changes who we follow up with",
  member: "so we can attach their booking and billing history",
  memberContact: "so the owner can close the loop directly",
  trainer: "it feeds their performance profile",
  classInfo: "so we can check the roster and capacity",
  location: "so the owner knows exactly where to go",
  systemAffected: "so we log it against the right platform",
  membershipRef: "Accounts need the exact package",
  occurredAt: "it affects how fast we need to respond",
  impact: "this sets the severity and SLA clock",
  atRisk: "safety cases jump the queue immediately",
  frequency: "repeat issues get a root-cause review",
  actionTaken: "so the owner doesn't repeat your work",
  witnesses: "we may need statements for the incident record",
  amount: "Accounts need the figure to process it",
};

/** Contextual tip shown under certain questions. */
export function coachTip(slot: SlotId, data: IntakeData): string | null {
  switch (slot) {
    case "member":
      return "Searching Momence attaches their visit count, packages and credits automatically.";
    case "classInfo":
      return data.trainerName
        ? `I'll filter to ${data.trainerName}'s recent sessions where I can.`
        : "Picking the real session locks in the exact date, time and teacher.";
    case "witnesses":
      return "Names only is fine — we just need to know who to ask.";
    case "location":
      return data.classInfo ? "If it happened mid-class, the studio floor is usually right." : null;
    case "actionTaken":
      return "Even 'apologised and moved them to Studio 2' is useful context.";
    case "amount":
      return "A rough figure is fine if you don't have the exact one.";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* LLM conversational rewrite                                          */
/* ------------------------------------------------------------------ */

export type Rewritten = { prompt: string; helper?: string; ack?: string };

/**
 * Ask the LLM for a warmer, situation-specific phrasing. Falls back to the
 * deterministic copy whenever no key is configured or the call fails.
 */
export async function humanise(input: {
  slot: SlotId;
  defaultPrompt: string;
  report: string;
  category: string;
  subcategory: string;
  known: Record<string, string>;
  asked: string[];
  reporterFirstName: string;
  remaining: number;
}): Promise<Rewritten | null> {
  const key = await getOpenAiKey();
  if (!key.startsWith("sk-")) return null;
  const model = (await getSetting("openai_model")) || process.env.OPENAI_MODEL || "gpt-4o-mini";

  const knownLines = Object.entries(input.known)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.55,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are Iris, a warm and efficient intake assistant for Physique 57, a boutique barre studio group in India.",
              "You are talking to a staff member who is logging an issue. Be friendly, concise and human — never corporate or robotic.",
              "Return strict JSON: {\"ack\": string, \"prompt\": string, \"helper\": string}.",
              "ack: at most 8 words reacting to what they just told you. Can be empty string.",
              "prompt: the next question, under 16 words, specific to this situation, never repeating known facts.",
              "helper: at most 14 words explaining why you need it or how to answer. Can be empty string.",
              "Never invent facts. Never ask for something already known. Use British English.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Staff member: ${input.reporterFirstName}`,
              `What they reported: "${input.report}"`,
              `Classified as: ${input.category} › ${input.subcategory}`,
              `Already known — ${knownLines || "nothing yet"}`,
              `Already asked: ${input.asked.join(", ") || "nothing"}`,
              `Still needed: ${input.slot}`,
              `Questions remaining after this: ${Math.max(0, input.remaining - 1)}`,
              `Default wording: "${input.defaultPrompt}"`,
            ].join("\n"),
          },
        ],
      }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Rewritten;
    if (!parsed.prompt?.trim()) return null;
    return {
      prompt: parsed.prompt.trim(),
      helper: parsed.helper?.trim() || undefined,
      ack: parsed.ack?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

/** Friendly closing line once the ticket is raised. */
export function closingLine(assignee: string | null, hours: number): string {
  if (!assignee) return "It's in the triage queue — someone will pick it up shortly.";
  const first = assignee.split(" ")[0];
  if (hours <= 1) return `${first} is on it now — this one has a ${hours * 60}-minute response target.`;
  if (hours <= 8) return `${first} has it, with a ${hours}-hour target. I'll keep the clock running.`;
  return `${first} owns it now. Target is ${hours} hours — you'll see it move in the queue.`;
}
