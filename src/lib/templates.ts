import type { Priority } from "./taxonomy";
import { MEMBERSHIPS, OCCURRED_OPTIONS, STUDIO_AREAS, SYSTEMS } from "./catalog";

export type FieldKind =
  | "member" | "session" | "private-session" | "trainer" | "studio" | "membership"
  | "select" | "multiselect" | "text" | "textarea" | "number" | "time" | "date" | "boolean" | "rating" | "attendees";

export type TemplateField = {
  kind: FieldKind;
  label: string;
  name: string;
  options?: string[];
  placeholder?: string;
  helper?: string;
  required?: boolean;
  /** Only render when this predicate passes — makes the form dynamic. */
  when?: (v: Record<string, string>) => boolean;
  max?: number;
};

export type Template = {
  id: string;
  name: string;
  blurb: string;
  icon: string;
  category: string;
  subcategory: string;
  priority: Priority;
  raisedFor: string;
  group: TemplateGroup;
  special?: "hosted-class" | "trainer-late";
  fields: TemplateField[];
  compose: (v: Record<string, string>) => string;
};

export type TemplateGroup =
  | "Facilities"
  | "Class & Trainer"
  | "Member & Billing"
  | "Systems"
  | "Safety"
  | "Feedback Programmes"
  | "Internal Ops";

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  "Feedback Programmes",
  "Class & Trainer",
  "Facilities",
  "Member & Billing",
  "Systems",
  "Safety",
  "Internal Ops",
];

const WHEN = OCCURRED_OPTIONS;
const RATING = ["5 — Outstanding", "4 — Good", "3 — Acceptable", "2 — Below par", "1 — Poor"];

export const TEMPLATES: Template[] = [
  /* ---------------- Feedback programmes ---------------- */
  {
    id: "hosted-class-feedback",
    name: "Hosted class feedback",
    blurb: "Private / community class review with full attendee roster from Momence",
    icon: "◉",
    category: "Class Experience",
    subcategory: "Class Format Satisfaction",
    priority: "Medium",
    raisedFor: "Noticed by staff",
    group: "Feedback Programmes",
    special: "hosted-class",
    fields: [
      { kind: "private-session", label: "Hosted session", name: "session", required: true, helper: "Pick the private / hosted session — attendees, host, trainer and studio auto-populate." },
      { kind: "text", label: "Host name", name: "hostName", placeholder: "Who hosted / brought the group", required: true },
      { kind: "text", label: "Host organisation", name: "hostOrg", placeholder: "Company, community or brand" },
      { kind: "rating", label: "Host experience", name: "hostScore", required: true, helper: "How well did the host manage their guests and the partnership?" },
      { kind: "rating", label: "Class delivery", name: "classScore", required: true },
      { kind: "select", label: "Was the audience relevant?", name: "audienceRelevance", options: ["Highly relevant — target demographic", "Mostly relevant", "Mixed audience", "Largely irrelevant"], required: true },
      { kind: "select", label: "Overall purchase intent", name: "purchaseIntent", options: ["Strong — several ready to buy", "Moderate — needs follow-up", "Low — curiosity only", "None observed"], required: true },
      { kind: "number", label: "Hot leads identified", name: "conversionCount", placeholder: "e.g. 4" },
      { kind: "select", label: "Would we host them again?", name: "repeatIntent", options: ["Yes — priority partner", "Yes — with conditions", "Unsure", "No"], required: true },
      { kind: "textarea", label: "Conditions / concerns", name: "repeatNotes", when: (v) => v.repeatIntent === "Yes — with conditions" || v.repeatIntent === "No", placeholder: "What would need to change?" },
      { kind: "attendees", label: "Attendee feedback", name: "attendees", helper: "Log per-guest status, intent and comments." },
      { kind: "textarea", label: "Overall notes", name: "notes", placeholder: "Logistics, room setup, follow-up plan" },
    ],
    compose: (v) =>
      `Hosted class review — ${v.sessionName ?? "session"}${v.hostName ? ` hosted by ${v.hostName}` : ""}${v.hostOrg ? ` (${v.hostOrg})` : ""}. Host experience ${v.hostScore ?? "-"}, class delivery ${v.classScore ?? "-"}. Audience: ${v.audienceRelevance ?? "-"}. Purchase intent: ${v.purchaseIntent ?? "-"}${v.conversionCount ? ` with ${v.conversionCount} hot leads` : ""}. Repeat: ${v.repeatIntent ?? "-"}. ${v.repeatNotes ?? ""} ${v.notes ?? ""}`.trim(),
  },
  {
    id: "trainer-late-arrival",
    name: "Trainer late arrival",
    blurb: "Structured service-recovery record when a trainer reports late",
    icon: "◔",
    category: "Trainer Feedback",
    subcategory: "Trainer Punctuality Issues",
    priority: "High",
    raisedFor: "Noticed by staff",
    group: "Feedback Programmes",
    special: "trainer-late",
    fields: [
      { kind: "session", label: "Affected class", name: "session", required: true, helper: "Pick the Momence session — start time, teacher and studio auto-fill." },
      { kind: "trainer", label: "Trainer", name: "trainer", required: true },
      { kind: "time", label: "Scheduled start", name: "scheduledStart", required: true },
      { kind: "time", label: "Actual arrival time", name: "arrivalTime", required: true },
      { kind: "time", label: "Class actually started", name: "actualStart" },
      { kind: "select", label: "Minutes late", name: "minutesLate", options: ["Under 5 minutes", "5–10 minutes", "10–20 minutes", "20–30 minutes", "Over 30 minutes", "Did not arrive"], required: true },
      { kind: "select", label: "Did the trainer inform in advance?", name: "informed", options: ["Yes — more than 2 hours before", "Yes — within 2 hours", "Yes — after class start time", "No prior notice"], required: true },
      { kind: "time", label: "Time the trainer informed us", name: "informedAt", when: (v) => (v.informed ?? "").startsWith("Yes") },
      { kind: "select", label: "Who did they inform?", name: "informedWho", options: ["Studio manager", "Front desk", "Head trainer", "WhatsApp group", "Nobody directly"], when: (v) => (v.informed ?? "").startsWith("Yes") },
      { kind: "select", label: "Reason given", name: "reason", options: ["Traffic / commute", "Personal emergency", "Illness", "Overlapping class", "Overslept", "Transport breakdown", "No reason given", "Other"], required: true },
      { kind: "text", label: "Reason detail", name: "reasonDetail", when: (v) => v.reason === "Other" || v.reason === "Personal emergency", placeholder: "Brief detail" },
      { kind: "number", label: "Clients affected", name: "clientsAffected", placeholder: "How many booked in", required: true },
      { kind: "number", label: "Clients who walked out", name: "walkouts", placeholder: "0" },
      { kind: "select", label: "How was the class covered?", name: "coverage", options: ["Trainer arrived and ran full class", "Trainer arrived, shortened class", "Substitute trainer covered", "Front desk led a warm-up until arrival", "Class cancelled"], required: true },
      { kind: "trainer", label: "Substitute trainer", name: "substitute", when: (v) => v.coverage === "Substitute trainer covered" },
      { kind: "multiselect", label: "Service recovery offered", name: "recovery", options: ["Apology in person", "Apology call / message", "Class credit refunded", "Complimentary class", "Retail / smoothie voucher", "Manager follow-up scheduled", "None yet"], required: true },
      { kind: "select", label: "Is this a repeat offence?", name: "repeat", options: ["First occurrence", "Second in 30 days", "Third or more in 30 days"], required: true },
      { kind: "textarea", label: "Escalation / next step", name: "escalation", when: (v) => v.repeat !== "First occurrence", placeholder: "Formal warning, roster change, coaching plan" },
      { kind: "textarea", label: "Additional notes", name: "notes" },
    ],
    compose: (v) =>
      `Trainer late arrival — ${v.trainerName ?? v.trainer ?? "trainer"} for ${v.sessionName ?? "class"} (scheduled ${v.scheduledStart ?? "-"}). Arrived ${v.arrivalTime ?? "-"}, ${v.minutesLate ?? "-"} late; class started ${v.actualStart ?? "-"}. Notice: ${v.informed ?? "-"}${v.informedAt ? ` at ${v.informedAt}` : ""}${v.informedWho ? ` via ${v.informedWho}` : ""}. Reason: ${v.reason ?? "-"}${v.reasonDetail ? ` — ${v.reasonDetail}` : ""}. ${v.clientsAffected ?? "0"} clients affected${v.walkouts && v.walkouts !== "0" ? `, ${v.walkouts} walked out` : ""}. Coverage: ${v.coverage ?? "-"}${v.substituteName ? ` by ${v.substituteName}` : ""}. Service recovery: ${v.recovery ?? "none"}. ${v.repeat ?? ""}. ${v.escalation ?? ""} ${v.notes ?? ""}`.trim(),
  },

  /* ---------------- Facilities ---------------- */
  {
    id: "ac-not-cooling",
    name: "AC / temperature issue",
    blurb: "HVAC not performing, studio too hot or cold",
    icon: "◈",
    category: "Repair and Maintenance",
    subcategory: "AC and HVAC Issues",
    priority: "High",
    raisedFor: "Noticed by staff",
    group: "Facilities",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "Area", name: "area", options: STUDIO_AREAS, required: true },
      { kind: "select", label: "Problem", name: "problem", options: ["Not cooling", "Not heating", "Too cold", "Noisy unit", "Leaking water", "Smells musty"], required: true },
      { kind: "select", label: "Unit / zone", name: "zone", options: ["Main floor AHU", "Split unit 1", "Split unit 2", "Cycle studio unit", "Reception unit", "Unknown"], when: (v) => !!v.problem },
      { kind: "number", label: "Current room temperature (°C)", name: "temperature", when: (v) => v.problem === "Not cooling" || v.problem === "Too cold" || v.problem === "Not heating" },
      { kind: "select", label: "When", name: "when", options: WHEN, required: true },
      { kind: "session", label: "Class affected", name: "session" },
      { kind: "select", label: "Have classes been disrupted?", name: "disrupted", options: ["No — comfort issue only", "Yes — members complained", "Yes — members left mid-class", "Yes — class relocated or cancelled"], required: true },
      { kind: "textarea", label: "Extra detail", name: "extra", placeholder: "Anything else facilities should know" },
    ],
    compose: (v) =>
      `AC / HVAC — ${v.problem ?? "fault"} in ${v.area ?? "the studio"}${v.zone && v.zone !== "Unknown" ? ` (${v.zone})` : ""}${v.temperature ? `, room at ${v.temperature}°C` : ""}. Reported ${(v.when ?? "").toLowerCase()}. ${v.disrupted ?? ""}.${v.sessionName ? ` Class affected: ${v.sessionName}.` : ""} ${v.extra ?? ""}`,
  },
  {
    id: "equipment-broken",
    name: "Broken equipment",
    blurb: "Barre, weights, bikes, bands, mats or props damaged",
    icon: "◇",
    category: "Repair and Maintenance",
    subcategory: "Broken Equipment Not Repaired",
    priority: "High",
    raisedFor: "Noticed by staff",
    group: "Facilities",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "Equipment", name: "equipment", options: ["Barre bar", "Weights / dumbbells", "Resistance bands", "Playground balls", "Mats", "Spin bike", "Strength rig", "Mirror", "Sound system", "Other"], required: true },
      { kind: "text", label: "Asset / position", name: "qty", placeholder: "e.g. bars 4 & 5 on the left wall, bike 12" },
      { kind: "select", label: "Injury risk", name: "safe", options: ["High — cordoned off, unsafe", "Medium — usable with caution", "Low — cosmetic only"], required: true },
      { kind: "select", label: "Has anyone been hurt?", name: "injury", options: ["No", "Near miss reported", "Yes — minor", "Yes — required first aid"], required: true },
      { kind: "member", label: "Injured member", name: "member", when: (v) => (v.injury ?? "").startsWith("Yes") },
      { kind: "select", label: "When", name: "when", options: WHEN, required: true },
      { kind: "textarea", label: "Description", name: "extra", placeholder: "What exactly is wrong?", required: true },
    ],
    compose: (v) =>
      `${v.equipment ?? "Equipment"} damaged${v.qty ? ` (${v.qty})` : ""}. Injury risk: ${v.safe ?? "-"}. Injuries: ${v.injury ?? "No"}${v.memberName ? ` — ${v.memberName}` : ""}. Noticed ${(v.when ?? "").toLowerCase()}. ${v.extra ?? ""}`,
  },
  {
    id: "cleanliness",
    name: "Cleanliness / hygiene",
    blurb: "Washrooms, lockers, studio floor or lounge not clean",
    icon: "◍",
    category: "Studio Amenities and Facilities",
    subcategory: "Cleanliness and Hygiene",
    priority: "Medium",
    raisedFor: "Noticed by staff",
    group: "Facilities",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "Area", name: "area", options: STUDIO_AREAS, required: true },
      { kind: "select", label: "Issue", name: "issue", options: ["Not cleaned", "Bad odour", "Supplies out of stock", "Wet / slippery floor", "Bins overflowing", "Dust or mould", "Pest sighting"], required: true },
      { kind: "select", label: "Which supply?", name: "supply", options: ["Towels", "Hand soap", "Shampoo / conditioner", "Toilet paper", "Sanitiser", "Deodorant / toiletries", "Water cups"], when: (v) => v.issue === "Supplies out of stock" },
      { kind: "select", label: "Pest type", name: "pest", options: ["Cockroach", "Rodent", "Ants", "Mosquitoes", "Other"], when: (v) => v.issue === "Pest sighting" },
      { kind: "select", label: "Reported by members?", name: "memberReported", options: ["No — staff noticed", "One member", "Multiple members"], required: true },
      { kind: "select", label: "When", name: "when", options: WHEN, required: true },
      { kind: "textarea", label: "Extra detail", name: "extra" },
    ],
    compose: (v) =>
      `${v.issue ?? "Cleanliness issue"} in ${v.area ?? "the studio"}${v.supply ? ` — ${v.supply} out of stock` : ""}${v.pest ? ` — ${v.pest} sighted` : ""}. ${v.memberReported ?? ""}. Noticed ${(v.when ?? "").toLowerCase()}. ${v.extra ?? ""}`,
  },

  /* ---------------- Class & trainer ---------------- */
  {
    id: "trainer-feedback",
    name: "Trainer feedback",
    blurb: "Praise or concern about an instructor",
    icon: "◑",
    category: "Trainer Feedback",
    subcategory: "Trainer Behaviour",
    priority: "Medium",
    raisedFor: "On behalf of a member",
    group: "Class & Trainer",
    fields: [
      { kind: "trainer", label: "Trainer", name: "trainer", required: true },
      { kind: "session", label: "Class", name: "session", required: true },
      { kind: "member", label: "Member raising it", name: "member" },
      { kind: "select", label: "Sentiment", name: "tone", options: ["Positive feedback", "Constructive concern", "Serious complaint"], required: true },
      { kind: "select", label: "Theme", name: "theme", options: ["Punctuality", "Behaviour / tone", "Class intensity", "Hands-on adjustments", "Engagement with clients", "Knowledge & competence", "Encouragement", "Injury prevention & safety", "Use of names", "Music & energy"], required: true },
      { kind: "rating", label: "Overall rating", name: "rating", when: (v) => v.tone === "Positive feedback" },
      { kind: "select", label: "Severity", name: "severity", options: ["Coaching note only", "Needs a conversation", "Formal review required", "Immediate escalation"], when: (v) => v.tone !== "Positive feedback", required: true },
      { kind: "select", label: "Has this come up before?", name: "repeat", options: ["First time", "Second or third time", "Recurring pattern"], when: (v) => v.tone !== "Positive feedback" },
      { kind: "textarea", label: "What happened", name: "extra", required: true },
    ],
    compose: (v) =>
      `${v.tone ?? "Feedback"} for ${v.trainerName ?? v.trainer ?? ""} — ${v.theme ?? ""}${v.rating ? ` (${v.rating})` : ""}${v.severity ? `. Severity: ${v.severity}` : ""}${v.repeat ? `. ${v.repeat}` : ""}.${v.sessionName ? ` Class: ${v.sessionName}.` : ""}${v.memberName ? ` Raised by ${v.memberName}.` : ""} ${v.extra ?? ""}`,
  },
  {
    id: "class-experience",
    name: "Class experience issue",
    blurb: "Overcrowding, music, pacing or comfort during class",
    icon: "◒",
    category: "Class Experience",
    subcategory: "Class Flow and Pacing",
    priority: "Medium",
    raisedFor: "On behalf of a member",
    group: "Class & Trainer",
    fields: [
      { kind: "session", label: "Class", name: "session", required: true },
      { kind: "member", label: "Member", name: "member" },
      { kind: "select", label: "Issue", name: "issue", options: ["Overcrowding in class", "Audio issues", "Studio temperature", "Class flow and pacing", "Bad odour", "Modifications not offered", "Instructor energy", "Class ran over time"], required: true },
      { kind: "number", label: "Booked vs capacity", name: "capacity", placeholder: "e.g. 26 booked / 22 spots", when: (v) => v.issue === "Overcrowding in class" },
      { kind: "select", label: "Music / audio detail", name: "audio", options: ["Too loud", "Too quiet", "Cutting out", "Wrong playlist", "Distorted"], when: (v) => v.issue === "Audio issues" },
      { kind: "select", label: "How many affected?", name: "affected", options: ["One member", "A few members", "Most of the class"], required: true },
      { kind: "textarea", label: "What happened", name: "extra", required: true },
    ],
    compose: (v) =>
      `${v.issue ?? "Class experience issue"}${v.capacity ? ` (${v.capacity})` : ""}${v.audio ? ` — ${v.audio}` : ""} in ${v.sessionName ?? "class"}. ${v.affected ?? ""} affected.${v.memberName ? ` Member: ${v.memberName}.` : ""} ${v.extra ?? ""}`,
  },
  {
    id: "schedule-request",
    name: "Scheduling request",
    blurb: "Time change, extra class, waitlist or capacity",
    icon: "◷",
    category: "Scheduling",
    subcategory: "Additional Classes",
    priority: "Low",
    raisedFor: "Multiple members",
    group: "Class & Trainer",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "Request type", name: "type", options: ["Additional class", "Time change", "Level change", "Waitlist concern", "Class capacity", "Trainer preference", "Studio timings", "Class cancellation", "Workshop / event scheduling"], required: true },
      { kind: "session", label: "Existing class affected", name: "session", when: (v) => v.type === "Time change" || v.type === "Level change" || v.type === "Class capacity" || v.type === "Class cancellation" },
      { kind: "text", label: "Preferred slot", name: "slot", placeholder: "e.g. Weekdays 8:30 PM", when: (v) => v.type === "Additional class" || v.type === "Time change" },
      { kind: "trainer", label: "Preferred trainer", name: "trainer", when: (v) => v.type === "Trainer preference" },
      { kind: "select", label: "Cancellation reason", name: "cancelReason", options: ["Low enrolment", "Trainer unavailable", "Studio unavailable / renovation", "Public holiday", "Weather / force majeure", "Other"], when: (v) => v.type === "Class cancellation", required: true },
      { kind: "boolean", label: "Members already notified?", name: "membersNotified", when: (v) => v.type === "Class cancellation" },
      { kind: "text", label: "Workshop / event name", name: "eventName", placeholder: "e.g. New Year Barre Bootcamp", when: (v) => v.type === "Workshop / event scheduling", required: true },
      { kind: "date", label: "Proposed date", name: "eventDate", when: (v) => v.type === "Workshop / event scheduling", required: true },
      { kind: "number", label: "Planned capacity", name: "eventCapacity", placeholder: "e.g. 20", when: (v) => v.type === "Workshop / event scheduling" },
      { kind: "trainer", label: "Lead trainer", name: "eventTrainer", when: (v) => v.type === "Workshop / event scheduling" },
      { kind: "number", label: "Members requesting", name: "demand", placeholder: "e.g. 4", when: (v) => v.type !== "Class cancellation" && v.type !== "Workshop / event scheduling", required: true },
      { kind: "textarea", label: "Context", name: "extra" },
    ],
    compose: (v) =>
      v.type === "Class cancellation"
        ? `Class cancellation — ${v.sessionName ?? "class"}. Reason: ${v.cancelReason ?? "-"}. Members notified: ${v.membersNotified ?? "-"}. ${v.extra ?? ""}`
        : v.type === "Workshop / event scheduling"
          ? `Workshop / event request — ${v.eventName ?? ""} proposed for ${v.eventDate ?? "-"}${v.eventCapacity ? `, capacity ${v.eventCapacity}` : ""}${v.eventTrainerName ? `, lead trainer ${v.eventTrainerName}` : ""}. ${v.extra ?? ""}`
          : `${v.type ?? "Scheduling request"}${v.slot ? ` for ${v.slot}` : ""}${v.sessionName ? ` (affects ${v.sessionName})` : ""}${v.trainerName ? `, preferred trainer ${v.trainerName}` : ""}. ${v.demand ?? "Some"} members requesting. ${v.extra ?? ""}`,
  },

  /* ---------------- Member & billing ---------------- */
  {
    id: "billing-issue",
    name: "Billing / membership issue",
    blurb: "Wrong charge, refund, freeze, renewal or expiry",
    icon: "◫",
    category: "Pricing and Memberships",
    subcategory: "Refund and Cancellation Policy Issue",
    priority: "High",
    raisedFor: "On behalf of a member",
    group: "Member & Billing",
    fields: [
      { kind: "member", label: "Member", name: "member", required: true },
      { kind: "membership", label: "Membership / package", name: "membership", options: MEMBERSHIPS, required: true },
      { kind: "select", label: "Issue", name: "issue", options: ["Incorrect charge", "Refund requested", "Auto-renewal dispute", "Freeze / pause request", "Class pack expiry", "Upgrade / downgrade", "Discount or offer confusion", "Payment failed"], required: true },
      { kind: "number", label: "Amount in dispute (₹)", name: "amount", when: (v) => v.issue === "Incorrect charge" || v.issue === "Refund requested" || v.issue === "Auto-renewal dispute" },
      { kind: "text", label: "Transaction date", name: "date", placeholder: "e.g. 5 Aug", when: (v) => !!v.issue && v.issue !== "Freeze / pause request" },
      { kind: "select", label: "Payment method", name: "method", options: ["Razorpay", "Stripe", "Card at POS", "UPI", "Bank transfer", "Cash"], when: (v) => v.issue === "Incorrect charge" || v.issue === "Payment failed" || v.issue === "Refund requested" },
      { kind: "text", label: "Freeze dates requested", name: "freezeDates", placeholder: "e.g. 10 Aug – 10 Sep", when: (v) => v.issue === "Freeze / pause request" },
      { kind: "select", label: "Member's stated intent", name: "intent", options: ["Wants it corrected and will stay", "Considering cancelling", "Has asked to cancel", "Threatening a chargeback"], required: true },
      { kind: "textarea", label: "What the member said", name: "extra", required: true },
    ],
    compose: (v) =>
      `${v.issue ?? "Billing issue"} raised by ${v.memberName ?? "a member"} on ${v.membershipName ?? v.membership ?? "their package"}${v.amount ? `. Amount: ₹${v.amount}` : ""}${v.date ? `, transaction ${v.date}` : ""}${v.method ? ` via ${v.method}` : ""}${v.freezeDates ? `. Freeze requested ${v.freezeDates}` : ""}. Member intent: ${v.intent ?? "-"}. ${v.extra ?? ""}`,
  },
  {
    id: "service-complaint",
    name: "Service / response complaint",
    blurb: "No reply, front desk attitude, unresolved complaint",
    icon: "◎",
    category: "Customer Service and Communication",
    subcategory: "Delay in Response",
    priority: "Medium",
    raisedFor: "On behalf of a member",
    group: "Member & Billing",
    fields: [
      { kind: "member", label: "Member", name: "member", required: true },
      { kind: "studio", label: "Studio", name: "studio" },
      { kind: "select", label: "Issue", name: "issue", options: ["Delay in response", "Front desk attitude", "Unresolved complaint", "Miscommunication on offers", "Call handling etiquette", "Follow-up not done"], required: true },
      { kind: "select", label: "Channel", name: "channel", options: ["WhatsApp", "Phone call", "Email", "In studio", "Instagram / social", "Momence app"], required: true },
      { kind: "select", label: "How long have they waited?", name: "waited", options: ["Under 24 hours", "1–2 days", "3–5 days", "Over a week"], when: (v) => v.issue === "Delay in response" || v.issue === "Follow-up not done" },
      { kind: "text", label: "Original request date", name: "originalDate", when: (v) => v.issue === "Unresolved complaint" },
      { kind: "textarea", label: "Details", name: "extra", required: true },
    ],
    compose: (v) =>
      `${v.issue ?? "Service complaint"} via ${v.channel ?? "unknown channel"} from ${v.memberName ?? "a member"}${v.waited ? `, waiting ${v.waited}` : ""}${v.originalDate ? `, originally raised ${v.originalDate}` : ""}. ${v.extra ?? ""}`,
  },

  /* ---------------- Systems ---------------- */
  {
    id: "system-down",
    name: "System / software fault",
    blurb: "Momence, POS, CRM, app or website not working",
    icon: "◨",
    category: "Operating Systems",
    subcategory: "Software Bugs",
    priority: "High",
    raisedFor: "Noticed by staff",
    group: "Systems",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "System", name: "system", options: SYSTEMS, required: true },
      { kind: "select", label: "Impact", name: "impact", options: ["Blocking check-ins or payments", "Slowing the team down", "Cosmetic / minor"], required: true },
      { kind: "text", label: "Error message", name: "error", placeholder: "Copy the exact wording", when: (v) => v.impact !== "Cosmetic / minor" },
      { kind: "select", label: "How often?", name: "frequency", options: ["Every time", "Intermittent", "Happened once"], required: true },
      { kind: "select", label: "Workaround in place?", name: "workaround", options: ["Yes — manual process", "Yes — using another device", "No workaround"], required: true },
      { kind: "textarea", label: "Steps to reproduce", name: "extra", required: true },
    ],
    compose: (v) =>
      `${v.system ?? "System"} fault — ${v.impact ?? ""}, occurring ${(v.frequency ?? "").toLowerCase()}.${v.error ? ` Error: "${v.error}".` : ""} Workaround: ${v.workaround ?? "-"}. ${v.extra ?? ""}`,
  },
  {
    id: "hardware-fault",
    name: "Hardware / AV fault",
    blurb: "Mic, speakers, laptop, Wi-Fi or phones",
    icon: "◧",
    category: "Tech Issues",
    subcategory: "Mic Not Working",
    priority: "High",
    raisedFor: "Noticed by staff",
    group: "Systems",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "Device", name: "device", options: ["Headset mic", "Speakers", "Laptop", "Studio Wi-Fi", "Router", "Phones", "TV / screen", "Camera / CCTV", "iPad"], required: true },
      { kind: "select", label: "Area", name: "area", options: STUDIO_AREAS, required: true },
      { kind: "select", label: "Backup available?", name: "backup", options: ["Yes — using backup", "Backup also faulty", "No backup available"], required: true },
      { kind: "session", label: "Class disrupted", name: "session", when: (v) => v.backup !== "Yes — using backup" },
      { kind: "textarea", label: "Symptoms", name: "extra", required: true },
    ],
    compose: (v) =>
      `${v.device ?? "Device"} fault in ${v.area ?? "the studio"}. ${v.backup ?? ""}.${v.sessionName ? ` Class disrupted: ${v.sessionName}.` : ""} ${v.extra ?? ""}`,
  },

  /* ---------------- Safety ---------------- */
  {
    id: "lost-item",
    name: "Lost / stolen item",
    blurb: "Member property missing or left behind",
    icon: "◊",
    category: "Theft and Lost Items",
    subcategory: "Stolen Personal Items",
    priority: "High",
    raisedFor: "On behalf of a member",
    group: "Safety",
    fields: [
      { kind: "member", label: "Member", name: "member", required: true },
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "Type", name: "type", options: ["Suspected theft", "Left behind / lost", "Missing from locker", "Missing from boutique"], required: true },
      { kind: "text", label: "Item", name: "item", placeholder: "e.g. gold earrings, black AirPods", required: true },
      { kind: "number", label: "Approx value (₹)", name: "value", when: (v) => v.type === "Suspected theft" || v.type === "Missing from locker" },
      { kind: "text", label: "Locker number", name: "locker", when: (v) => v.type === "Missing from locker" },
      { kind: "select", label: "Area", name: "area", options: STUDIO_AREAS, required: true },
      { kind: "session", label: "Class attended", name: "session" },
      { kind: "select", label: "CCTV available for the window?", name: "cctv", options: ["Yes — footage pulled", "Yes — needs pulling", "No coverage in that area", "Camera not working"], when: (v) => v.type === "Suspected theft" || v.type === "Missing from locker", required: true },
      { kind: "select", label: "Police report needed?", name: "police", options: ["No", "Member considering it", "Yes — filed", "Yes — pending"], when: (v) => v.type === "Suspected theft" },
      { kind: "select", label: "When", name: "when", options: WHEN, required: true },
      { kind: "textarea", label: "Details", name: "extra" },
    ],
    compose: (v) =>
      `${v.type ?? "Lost item"} — ${v.item ?? "item"}${v.value ? ` (approx ₹${v.value})` : ""} reported by ${v.memberName ?? "a member"} in ${v.area ?? "the studio"}${v.locker ? `, locker ${v.locker}` : ""}, ${(v.when ?? "").toLowerCase()}.${v.sessionName ? ` Class: ${v.sessionName}.` : ""}${v.cctv ? ` CCTV: ${v.cctv}.` : ""}${v.police ? ` Police: ${v.police}.` : ""} ${v.extra ?? ""}`,
  },
  {
    id: "safety-incident",
    name: "Safety incident",
    blurb: "Injury, blocked exit, harassment or emergency",
    icon: "◉",
    category: "Safety and Security",
    subcategory: "Handling of Medical Emergencies",
    priority: "Critical",
    raisedFor: "Noticed by staff",
    group: "Safety",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "Incident type", name: "type", options: ["Member injury", "Blocked emergency exit", "Harassment report", "Suspicious individual", "Fire / electrical hazard", "Medical emergency", "Panic button / alarm fault"], required: true },
      { kind: "select", label: "Area", name: "area", options: STUDIO_AREAS, required: true },
      { kind: "member", label: "Person involved", name: "member", when: (v) => v.type === "Member injury" || v.type === "Harassment report" || v.type === "Medical emergency" },
      { kind: "session", label: "Class in progress", name: "session", when: (v) => v.type === "Member injury" || v.type === "Medical emergency" },
      { kind: "select", label: "Injury severity", name: "injurySeverity", options: ["Minor — first aid on site", "Moderate — advised to see a doctor", "Serious — ambulance called", "Unclear"], when: (v) => v.type === "Member injury" || v.type === "Medical emergency", required: true },
      { kind: "select", label: "First aid administered?", name: "firstAid", options: ["Yes — by trained staff", "Yes — by a member", "No — not required", "No — nobody trained available"], when: (v) => v.type === "Member injury" || v.type === "Medical emergency" },
      { kind: "select", label: "Emergency services contacted?", name: "emergency", options: ["No", "Ambulance called", "Police called", "Fire services called"], when: (v) => v.type !== "Blocked emergency exit" },
      { kind: "text", label: "Witnesses", name: "witnesses", placeholder: "Names of staff or members present" },
      { kind: "select", label: "Current status", name: "status", options: ["Resolved on site", "Ongoing — needs immediate action", "Contained but needs follow-up"], required: true },
      { kind: "textarea", label: "Full account", name: "extra", placeholder: "What happened, who was present, action already taken", required: true },
    ],
    compose: (v) =>
      `URGENT ${v.type ?? "safety incident"} in ${v.area ?? "the studio"}. Status: ${v.status ?? ""}.${v.memberName ? ` Person involved: ${v.memberName}.` : ""}${v.injurySeverity ? ` Severity: ${v.injurySeverity}.` : ""}${v.firstAid ? ` First aid: ${v.firstAid}.` : ""}${v.emergency && v.emergency !== "No" ? ` ${v.emergency}.` : ""}${v.witnesses ? ` Witnesses: ${v.witnesses}.` : ""}${v.sessionName ? ` Class: ${v.sessionName}.` : ""} ${v.extra ?? ""}`,
  },
  /* ---------------- Internal ops ---------------- */
  {
    id: "retail-boutique-issue",
    name: "Retail / boutique issue",
    blurb: "Stock-outs, pricing errors, damaged retail goods",
    icon: "◺",
    category: "Studio Amenities and Facilities",
    subcategory: "Boutique Availability Issues",
    priority: "Medium",
    raisedFor: "Noticed by staff",
    group: "Internal Ops",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "Issue type", name: "issue", options: ["Out of stock", "Wrong price displayed", "Damaged / defective item", "Size / fit not available", "Item missing from shelf", "Return or exchange dispute"], required: true },
      { kind: "select", label: "Product category", name: "productCategory", options: ["Apparel", "Footwear", "Accessories", "Supplements / nutrition", "Water bottles / mats", "Other"], required: true },
      { kind: "text", label: "Product / item", name: "item", placeholder: "e.g. Studio branded leggings, size M", required: true },
      { kind: "number", label: "Approx value (₹)", name: "value", when: (v) => v.issue === "Damaged / defective item" || v.issue === "Return or exchange dispute" },
      { kind: "member", label: "Member involved", name: "member", when: (v) => v.issue === "Return or exchange dispute" },
      { kind: "date", label: "Date noticed", name: "noticedDate", required: true },
      { kind: "boolean", label: "Restock already ordered?", name: "restockOrdered", when: (v) => v.issue === "Out of stock" },
      { kind: "textarea", label: "Extra detail", name: "extra" },
    ],
    compose: (v) =>
      `${v.issue ?? "Retail issue"} — ${v.item ?? "item"} (${v.productCategory ?? "-"})${v.value ? `, approx ₹${v.value}` : ""}. Noticed ${v.noticedDate ?? "-"}.${v.memberName ? ` Member: ${v.memberName}.` : ""}${v.restockOrdered ? ` Restock ordered: ${v.restockOrdered}.` : ""} ${v.extra ?? ""}`.trim(),
  },
  {
    id: "payment-reconciliation",
    name: "Payment reconciliation issue",
    blurb: "Gateway, POS or ledger mismatch — not a member dispute",
    icon: "◻",
    category: "Operating Systems",
    subcategory: "Payment Reconciliation Discrepancy",
    priority: "High",
    raisedFor: "Noticed by staff",
    group: "Internal Ops",
    fields: [
      { kind: "studio", label: "Studio", name: "studio", required: true },
      { kind: "select", label: "System", name: "system", options: ["Stripe", "Razorpay", "POS / card machine", "Bank statement", "Momence ledger", "Cash counting machine"], required: true },
      { kind: "select", label: "Discrepancy type", name: "discrepancy", options: ["Payment not reflecting in Momence", "Duplicate settlement", "Missing settlement", "Mismatched amount", "Refund not processed on gateway", "Chargeback dispute"], required: true },
      { kind: "number", label: "Amount in question (₹)", name: "amount", required: true },
      { kind: "date", label: "Transaction date", name: "transactionDate", required: true },
      { kind: "text", label: "Transaction / reference ID", name: "refId", placeholder: "Gateway or bank reference" },
      { kind: "select", label: "Scope", name: "scope", options: ["Isolated transaction", "Recurring pattern — multiple transactions", "Blocking daily reconciliation"], required: true },
      { kind: "boolean", label: "Member notified?", name: "memberNotified" },
      { kind: "textarea", label: "Details", name: "extra", required: true },
    ],
    compose: (v) =>
      `${v.discrepancy ?? "Payment reconciliation issue"} on ${v.system ?? "-"} — ₹${v.amount ?? "-"} dated ${v.transactionDate ?? "-"}${v.refId ? ` (ref ${v.refId})` : ""}. Scope: ${v.scope ?? "-"}. Member notified: ${v.memberNotified ?? "-"}. ${v.extra ?? ""}`,
  },
  {
    id: "internal-ops-request",
    name: "Internal ops / handover request",
    blurb: "SOPs, shift handover, payroll/HRIS access, partnership or campaign coordination",
    icon: "◼",
    category: "Miscellaneous",
    subcategory: "Internal Operations / Handover",
    priority: "Low",
    raisedFor: "Noticed by staff",
    group: "Internal Ops",
    fields: [
      { kind: "select", label: "Request type", name: "type", options: ["Shift handover note", "SOP / process alignment", "Payroll / performance review", "Zoho / HRIS access", "Partnership or collaboration approval", "Marketing campaign coordination", "Creative asset request", "Other internal request"], required: true },
      { kind: "studio", label: "Studio", name: "studio" },
      { kind: "select", label: "Urgency", name: "urgency", options: ["Can wait — routine", "Needed this week", "Blocking another team"], required: true },
      { kind: "date", label: "Needed by", name: "neededBy", when: (v) => v.urgency !== "Can wait — routine" },
      { kind: "boolean", label: "Approval required from management?", name: "approvalRequired", when: (v) => v.type === "Partnership or collaboration approval" || v.type === "Marketing campaign coordination" },
      { kind: "textarea", label: "Details", name: "extra", required: true },
    ],
    compose: (v) =>
      `${v.type ?? "Internal request"}${v.studioName ? ` — ${v.studioName}` : ""}. Urgency: ${v.urgency ?? "-"}${v.neededBy ? `, needed by ${v.neededBy}` : ""}.${v.approvalRequired ? ` Management approval: ${v.approvalRequired}.` : ""} ${v.extra ?? ""}`,
  },
];

export function templateById(id: string) {
  return TEMPLATES.find((t) => t.id === id);
}

export const RATING_OPTIONS = RATING;
