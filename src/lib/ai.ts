import {
  CATEGORIES,
  CATEGORY_HINTS,
  SUBCATEGORY_HINTS,
  TAXONOMY,
  metaFor,
  type Priority,
} from "./taxonomy";

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "is", "are", "was", "were",
  "it", "its", "this", "that", "there", "their", "they", "we", "i", "my", "our", "with", "not",
  "no", "very", "so", "but", "has", "have", "had", "be", "been", "am", "do", "does", "did", "as",
  "from", "by", "about", "into", "than", "then", "too", "also", "just", "some", "any", "can",
  "could", "would", "should", "will", "one", "member", "members", "client", "clients", "please",
  "issue", "issues", "problem", "problems", "raise", "ticket", "studio", "physique",
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/wi[-\s]?fi/g, "wifi")
    .replace(/a\/c\b/g, "ac")
    .replace(/air[-\s]?con(ditioner)?/g, "ac")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/** Tokens weighted by position — people state the core problem first. */
function weightedTokens(text: string): Map<string, number> {
  const map = new Map<string, number>();
  tokenize(text).forEach((token, idx) => {
    const weight = 1 + 0.8 * Math.max(0, 1 - idx / 10);
    if (!map.has(token)) map.set(token, weight);
  });
  return map;
}

type Doc = {
  category: string;
  subcategory: string;
  tokens: Set<string>;
  phrases: string[];
};

const DOCS: Doc[] = [];
const DF = new Map<string, number>();

for (const category of CATEGORIES) {
  for (const subcategory of TAXONOMY[category]) {
    const hints = SUBCATEGORY_HINTS[`${category}::${subcategory}`] ?? [];
    const tokens = new Set<string>([
      ...tokenize(subcategory),
      ...tokenize(category),
      ...hints.flatMap((h) => tokenize(h)),
    ]);
    DOCS.push({
      category,
      subcategory,
      tokens,
      phrases: hints.filter((h) => h.includes(" ")).map((h) => normalise(h)),
    });
    for (const token of tokens) DF.set(token, (DF.get(token) ?? 0) + 1);
  }
}

const TOTAL_DOCS = DOCS.length;

function idf(token: string): number {
  const df = DF.get(token) ?? 0;
  return Math.log((TOTAL_DOCS + 1) / (df + 1)) + 0.4;
}

export type Classification = {
  category: string;
  subcategory: string;
  score: number;
  confidence: number;
};

/** Lightweight on-device NLU: TF-IDF token overlap + phrase and category boosts. */
export function classify(text: string, limit = 4): Classification[] {
  const raw = normalise(text);
  const weights = weightedTokens(text);
  if (weights.size === 0) return [];

  const categoryBoost = new Map<string, number>();
  for (const [category, hints] of Object.entries(CATEGORY_HINTS)) {
    let boost = 0;
    for (const hint of hints) {
      if (raw.includes(hint)) boost += hint.includes(" ") ? 1.4 : 0.9;
    }
    categoryBoost.set(category, boost);
  }

  const scored = DOCS.map((doc) => {
    let score = 0;
    for (const [token, weight] of weights) {
      if (doc.tokens.has(token)) score += idf(token) * weight;
    }
    for (const phrase of doc.phrases) {
      if (raw.includes(phrase)) score += 3.6;
    }
    const subLower = doc.subcategory.toLowerCase();
    if (raw.includes(subLower)) score += 4.5;
    score += (categoryBoost.get(doc.category) ?? 0) * 0.55;
    return { category: doc.category, subcategory: doc.subcategory, score };
  })
    .filter((s) => s.score > 0.8)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const top: Classification[] = [];
  const best = scored[0]?.score ?? 1;
  for (const item of scored) {
    const key = `${item.category}::${item.subcategory}`;
    if (seen.has(key)) continue;
    seen.add(key);
    top.push({ ...item, confidence: Math.min(0.98, item.score / (best || 1)) });
    if (top.length >= limit) break;
  }
  return top;
}

const URGENT_WORDS = [
  "urgent", "immediately", "asap", "emergency", "danger", "dangerous", "fire", "smoke",
  "injury", "injured", "bleeding", "fainted", "unconscious", "harassment", "harassed",
  "assault", "theft", "stolen", "shock", "electric", "flood", "unsafe", "police", "ambulance",
];
const HIGH_WORDS = [
  "angry", "furious", "escalate", "escalation", "refund", "cancel membership", "threaten",
  "multiple members", "everyone", "again and again", "repeatedly", "third time", "still not fixed",
  "not working", "broken", "down", "leak",
];
const LOW_WORDS = ["suggestion", "idea", "would be nice", "maybe", "consider", "in future", "appreciate", "compliment"];

const NEGATIVE_WORDS = [
  "bad", "worst", "terrible", "awful", "rude", "angry", "upset", "disappointed", "frustrated",
  "dirty", "smell", "broken", "unacceptable", "poor", "horrible", "annoyed", "complaint", "hate",
];
const POSITIVE_WORDS = ["great", "loved", "amazing", "excellent", "appreciate", "kudos", "wonderful", "fantastic", "praise", "thank"];

export function detectSentiment(text: string): "Positive" | "Neutral" | "Negative" | "Escalated" {
  const raw = normalise(text);
  const neg = NEGATIVE_WORDS.filter((w) => raw.includes(w)).length;
  const pos = POSITIVE_WORDS.filter((w) => raw.includes(w)).length;
  const urgent = URGENT_WORDS.filter((w) => raw.includes(w)).length;
  if (urgent > 0 || neg >= 3) return "Escalated";
  if (neg > pos) return "Negative";
  if (pos > neg) return "Positive";
  return "Neutral";
}

const IMPACT_PRIORITY: Record<string, Priority> = {
  safety: "Critical",
  many: "High",
  single: "Medium",
  suggestion: "Low",
};

export function detectPriority(input: {
  text: string;
  category: string;
  impact?: string;
  atRisk?: boolean;
}): { priority: Priority; reason: string } {
  const raw = normalise(input.text);
  const reasons: string[] = [];
  let score = 1; // 0 low, 1 medium, 2 high, 3 critical
  const order: Priority[] = ["Low", "Medium", "High", "Critical"];

  const catDefault = metaFor(input.category).defaultPriority;
  score = order.indexOf(catDefault);
  reasons.push(`${input.category} baseline is ${catDefault}`);

  if (input.impact && IMPACT_PRIORITY[input.impact]) {
    const impactScore = order.indexOf(IMPACT_PRIORITY[input.impact]);
    score = Math.max(score, impactScore);
    if (impactScore >= order.indexOf(catDefault)) reasons.push("stated business impact");
  }

  const urgentHit = URGENT_WORDS.find((w) => raw.includes(w));
  if (urgentHit) {
    score = 3;
    reasons.push(`urgency signal "${urgentHit}"`);
  } else {
    const highHit = HIGH_WORDS.find((w) => raw.includes(w));
    if (highHit) {
      score = Math.max(score, 2);
      reasons.push(`severity signal "${highHit}"`);
    }
  }
  if (LOW_WORDS.some((w) => raw.includes(w)) && !urgentHit) {
    score = Math.min(score, 1);
  }
  if (input.atRisk) {
    score = 3;
    reasons.push("someone is at immediate risk");
  }

  return { priority: order[Math.max(0, Math.min(3, score))], reason: reasons.join(" · ") };
}

export function extractStudio(
  text: string,
  studios: { id: number; name: string; code: string; city: string }[],
): { id: number; name: string } | null {
  const raw = normalise(text);
  for (const studio of studios) {
    const localityWords = normalise(studio.name).split(" ").filter((w) => w.length > 3);
    if (raw.includes(normalise(studio.name))) return { id: studio.id, name: studio.name };
    if (localityWords.some((w) => raw.includes(w) && !["mumbai", "delhi", "india"].includes(w))) {
      return { id: studio.id, name: studio.name };
    }
  }
  return null;
}

export function extractPerson(text: string): string | null {
  const match = text.match(
    /\b(?:trainer|instructor|coach|teacher)\s+(?:named\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  );
  if (match) return match[1];
  const match2 = text.match(/\b([A-Z][a-z]{2,})\s+(?:the\s+)?(?:trainer|instructor|coach)\b/);
  return match2 ? match2[1] : null;
}

export function suggestTags(text: string, category: string, subcategory: string): string[] {
  const tags = new Set<string>();
  const raw = normalise(text);
  tags.add(category.toLowerCase().replace(/\s+/g, "-"));
  tags.add(subcategory.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  if (/recurring|again|repeat|third time|every day|daily/.test(raw)) tags.add("recurring");
  if (/vip|celebrity|founder|influencer/.test(raw)) tags.add("vip");
  if (/refund|charge|payment|invoice/.test(raw)) tags.add("billing");
  if (/safety|injury|emergency|harass/.test(raw)) tags.add("safety-review");
  return [...tags].slice(0, 6);
}

export function titleCaseSummary(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
