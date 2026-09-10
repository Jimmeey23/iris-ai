/**
 * Distills `data/historic-tickets.json` (the imported Athena export, 464 reports)
 * into a compact pattern digest the Iris agent can hold in its prompt — so it
 * answers knowing what issues this company actually sees, without importing the
 * rows. Read-only over the export; writes `src/lib/issue-knowledge.generated.ts`.
 *
 *   node scripts/build-issue-knowledge.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const SOURCE = path.join(ROOT, "data", "historic-tickets.json");
const OUT = path.join(ROOT, "src", "lib", "issue-knowledge.generated.ts");

/** Athena categories → the app's taxonomy (mirrors historic-import.ts). */
const CATEGORY_MAP = {
  "Internal Systems": "Operating Systems",
  "Facility / Hygiene": "Studio Amenities and Facilities",
  "Booking / Scheduling": "Scheduling",
  "Class Quality": "Class Experience",
  "Trainer Conduct": "Trainer Feedback",
  "Injury / Safety": "Safety and Security",
  "Communication Gap": "Customer Service and Communication",
  "Access / Check-in": "Operating Systems",
  Other: "Miscellaneous",
};

const STUDIO_HINTS = [
  { re: /kemps|kwality|colaba|south mumbai/i, label: "Kwality House, Kemps Corner" },
  { re: /bandra|supreme|khar|juhu/i, label: "Bandra / Juhu" },
  { re: /bengaluru|bangalore|indiranagar|kenkere/i, label: "Indiranagar / Kenkere (Bengaluru)" },
];

/** Hand-picked lexical anchors for the recurring issue families. */
const SEEDS = [
  { re: /temperature|ac\b|air\s?con/i, keywords: ["ac", "air conditioning", "temperature", "hot", "heat", "cooling", "stuffy", "humid", "warm", "servicing"] },
  { re: /theft|missing|locker|lost/i, keywords: ["theft", "stolen", "missing", "lost", "wallet", "phone", "locker", "valuables"] },
  { re: /punctualit|late entry|conduct|behaviou|rude|attitude/i, keywords: ["late", "punctuality", "rude", "attitude", "engagement", "conduct", "behaviour", "no-show", "left early", "phone"] },
  { re: /class experience|feedback|intensity/i, keywords: ["class experience", "intensity", "crowded", "music", "too fast", "too slow", "beginner", "feedback"] },
  { re: /data accuracy|crm|momence|integration/i, keywords: ["momence", "crm", "data", "sync", "inaccurate", "bookings", "waitlist", "integration"] },
  { re: /payment|reconcil|finance/i, keywords: ["payment", "reconciliation", "pos", "settlement", "invoice", "billing", "refund", "charges"] },
  { re: /marketing|campaign|social|creative/i, keywords: ["campaign", "instagram", "social media", "post", "creative", "approval", "launch", "brand"] },
  { re: /injury|safety|incident|harass/i, keywords: ["injury", "injured", "fell", "slipped", "pain", "swelling", "sprain", "safety", "first aid", "ambulance"] },
  { re: /cancel|schedule|capacity|waitlist|imbalance/i, keywords: ["cancelled", "reschedule", "schedule", "timetable", "capacity", "waitlist", "slots", "empty class"] },
  { re: /hosted class|instructor swap|swap/i, keywords: ["hosted class", "instructor swap", "cover", "substitute", "swap"] },
  { re: /sop|checklist|procedure|handover|shift/i, keywords: ["sop", "checklist", "procedure", "handover", "shift", "process"] },
  { re: /payroll|performance review|hr|zoho/i, keywords: ["payroll", "performance review", "hr", "zoho", "salary", "appraisal"] },
  { re: /boutique|retail|offerings/i, keywords: ["boutique", "retail", "merchandise", "stock", "grip socks"] },
  { re: /workshop|capacity planning/i, keywords: ["workshop", "capacity", "planning", "special class"] },
  { re: /water|shower|hygiene|clean|washroom|toilet/i, keywords: ["water", "shower", "hygiene", "cleaning", "washroom", "smell", "towel"] },
  { re: /music|volume|speaker|sound|atmosphere/i, keywords: ["music", "volume", "speaker", "sound", "loud", "atmosphere"] },
];

const STOPWORDS = new Set(
  ("the and that with this have from they been will would there their what when which your about into them then than more also some just only over very much such because while after before during between through another been being were was has had did does doing member members studio studios class classes team staff report reporting ticket tickets issue issues need needs wants asked telling informed added shared said says like well okay please make made take taken get got going today tomorrow yesterday week month day time first new one two three" ).split(" "),
);

const asList = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);
const clean = (s, cap = 110) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  return (first.length > cap ? first.slice(0, cap).split(" ").slice(0, -1).join(" ") : first);
};
const ownerBase = (s) => String(s ?? "").replace(/\s*\(.*?\)\s*/g, "").replace(/[.\s]+$/,"").trim();
const tokens = (text) =>
  String(text ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));

const rows = JSON.parse(await readFile(SOURCE, "utf8"));
const dates = rows.map((r) => r.date_opened).filter(Boolean).sort();

// Group by mapped category + subcategory.
const groups = new Map();
for (const r of rows) {
  const cat = CATEGORY_MAP[r.complaint_category] ?? "Miscellaneous";
  const sub = String(r.complaint_subcategory ?? "").trim() || "General";
  const key = `${cat}|${sub}`;
  if (!groups.has(key)) groups.set(key, { cat, sub, rows: [] });
  groups.get(key).rows.push(r);
}

// Document frequency for IDF-style keyword scoring.
const df = new Map();
for (const g of groups.values()) {
  for (const w of new Set(g.rows.flatMap((r) => tokens(`${r.issue_summary} ${asList(r.key_customer_statements).join(" ")} ${r.root_cause ?? ""}`)))) {
    df.set(w, (df.get(w) ?? 0) + 1);
  }
}

const patterns = [];
for (const g of groups.values()) {
  if (g.rows.length < 2) continue;
  const text = g.rows.map((r) => `${r.issue_summary ?? ""} ${asList(r.key_customer_statements).join(" ")} ${r.root_cause ?? ""} ${r.complaint_subcategory ?? ""}`).join(" ");
  const lower = text.toLowerCase();

  const seeds = SEEDS.filter((s) => s.re.test(g.sub)).flatMap((s) => s.keywords);
  const scored = new Map();
  for (const w of new Set(tokens(text))) {
    const n = g.rows.reduce((acc, r) => acc + (tokens(`${r.issue_summary} ${asList(r.key_customer_statements).join(" ")}`).includes(w) ? 1 : 0), 0);
    if (n < 2) continue;
    scored.set(w, n * Math.log((groups.size + 1) / ((df.get(w) ?? 0) + 1)));
  }
  const auto = [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
  const keywords = [...new Set([...seeds, ...auto])].slice(0, 10);

  const causeCount = new Map();
  for (const r of g.rows) {
    const c = clean(r.root_cause);
    if (c) causeCount.set(c, (causeCount.get(c) ?? 0) + 1);
  }
  const rootCauses = [...causeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);

  const actionCount = new Map();
  for (const r of g.rows) for (const a of asList(r.recommended_actions)) {
    const c = clean(a, 100);
    if (c) actionCount.set(c, (actionCount.get(c) ?? 0) + 1);
  }
  const actions = [...actionCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a);

  const ownerCount = new Map();
  const studioCount = new Map();
  const prioCount = new Map();
  for (const r of g.rows) {
    const o = ownerBase(r.ownership);
    if (o) ownerCount.set(o, (ownerCount.get(o) ?? 0) + 1);
    const rtext = `${r.issue_summary ?? ""} ${asList(r.key_customer_statements).join(" ")} ${r.ownership ?? ""}`;
    for (const h of STUDIO_HINTS) if (h.re.test(rtext)) studioCount.set(h.label, (studioCount.get(h.label) ?? 0) + 1);
    prioCount.set(String(r.priority ?? "Medium"), (prioCount.get(String(r.priority ?? "Medium")) ?? 0) + 1);
  }
  const owners = [...ownerCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([o]) => o);
  const studios = [...studioCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([s]) => s);
  const priorityMode = [...prioCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Medium";

  patterns.push({
    category: g.cat,
    subcategory: g.sub,
    count: g.rows.length,
    keywords,
    rootCauses,
    actions,
    owners,
    studios,
    priorityMode,
  });
}
patterns.sort((a, b) => b.count - a.count);

// Ownership priors per category, and per category|subcategory.
const OWNER_PRIORS = {};
for (const p of patterns) {
  for (const key of [p.category, `${p.category}|${p.subcategory}`]) {
    const m = (OWNER_PRIORS[key] ??= {});
    for (const o of p.owners) m[o] = (m[o] ?? 0) + p.count;
  }
}
const ownerPriorsOut = Object.fromEntries(
  Object.entries(OWNER_PRIORS).map(([k, m]) => [
    k,
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([o]) => o),
  ]),
);

const longTail = rows.length - patterns.reduce((acc, p) => acc + p.count, 0);
const corpus = {
  total: rows.length,
  span: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "unknown",
  topIssues: patterns.slice(0, 6).map((p) => `${p.subcategory} (${p.count})`),
  longTail,
};

const banner = `// GENERATED by scripts/build-issue-knowledge.mjs from data/historic-tickets.json
// (${rows.length} historic reports, ${patterns.length} issue families). Do not edit by hand —
// re-run \`node scripts/build-issue-knowledge.mjs\` after refreshing the export.
// Used at runtime by src/lib/issue-knowledge.ts; never imported into the tickets table.`;

const body = `export type IssuePattern = {
  category: string;
  subcategory: string;
  count: number;
  keywords: string[];
  rootCauses: string[];
  actions: string[];
  owners: string[];
  studios: string[];
  priorityMode: string;
};

export const ISSUE_PATTERNS: IssuePattern[] = ${JSON.stringify(patterns, null, 2)};

export const OWNER_PRIORS: Record<string, string[]> = ${JSON.stringify(ownerPriorsOut, null, 2)};

export const CORPUS = ${JSON.stringify(corpus, null, 2)} as const;
`;

await writeFile(OUT, `${banner}\n\n${body}`);
console.log(`Wrote ${OUT}: ${patterns.length} patterns from ${rows.length} reports.`);
