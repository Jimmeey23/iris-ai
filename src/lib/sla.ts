import type { Priority } from "./taxonomy";

export type Severity = "Minor" | "Moderate" | "Major" | "Severe";
export const SEVERITIES: Severity[] = ["Minor", "Moderate", "Major", "Severe"];

/**
 * SLA policy per issue type. `respond` = first-response target,
 * `resolve` = resolution target, both in hours.
 */
export type SlaPolicy = { respond: number; resolve: number; label: string };

/** Category baseline SLA (hours). */
const CATEGORY_SLA: Record<string, SlaPolicy> = {
  "Safety and Security": { respond: 0.25, resolve: 2, label: "Safety critical" },
  "Theft and Lost Items": { respond: 1, resolve: 8, label: "Loss / investigation" },
  "Repair and Maintenance": { respond: 2, resolve: 24, label: "Facilities" },
  "Tech Issues": { respond: 1, resolve: 8, label: "Studio technology" },
  "Operating Systems": { respond: 1, resolve: 12, label: "Business systems" },
  "Pricing and Memberships": { respond: 4, resolve: 48, label: "Revenue & billing" },
  "Customer Service and Communication": { respond: 2, resolve: 24, label: "Guest experience" },
  "Trainer Feedback": { respond: 8, resolve: 72, label: "Coaching quality" },
  "Class Experience": { respond: 8, resolve: 48, label: "Class delivery" },
  Scheduling: { respond: 12, resolve: 96, label: "Timetable" },
  "Studio Amenities and Facilities": { respond: 4, resolve: 36, label: "Amenities" },
  "Brand Feedback": { respond: 24, resolve: 168, label: "Brand" },
  Miscellaneous: { respond: 12, resolve: 96, label: "General" },
};

/** Sharper overrides for specific subcategories that need a tighter or looser clock. */
const SUBCATEGORY_SLA: Record<string, SlaPolicy> = {
  "Emergency Exits Blocked": { respond: 0.25, resolve: 1, label: "Life safety — immediate" },
  "Handling of Medical Emergencies": { respond: 0.1, resolve: 1, label: "Medical emergency" },
  "Client Harassment Reports": { respond: 0.25, resolve: 4, label: "Harassment protocol" },
  "Harassment Reports": { respond: 0.25, resolve: 4, label: "Harassment protocol" },
  "Panic Button Malfunction": { respond: 0.5, resolve: 4, label: "Life safety device" },
  "Fire Safety Compliance": { respond: 0.5, resolve: 6, label: "Compliance critical" },
  "First Aid Kit Availability": { respond: 1, resolve: 6, label: "Safety readiness" },
  "Suspicious Individuals Inside Studio": { respond: 0.25, resolve: 2, label: "Security response" },
  "CCTV Malfunction": { respond: 2, resolve: 24, label: "Surveillance" },
  "Locker Theft": { respond: 0.5, resolve: 6, label: "Theft investigation" },
  "Stolen Personal Items": { respond: 0.5, resolve: 8, label: "Theft investigation" },
  "Staff Theft": { respond: 0.5, resolve: 8, label: "Internal investigation" },
  "AC and HVAC Issues": { respond: 1, resolve: 12, label: "Class-blocking comfort" },
  "Plumbing Leaks": { respond: 1, resolve: 8, label: "Water damage risk" },
  "Broken Equipment Not Repaired": { respond: 1, resolve: 24, label: "Injury risk" },
  "Studio System Malfunction": { respond: 1, resolve: 8, label: "Class-blocking" },
  "Mic Not Working": { respond: 0.5, resolve: 4, label: "Class-blocking AV" },
  "Speakers Static Noise": { respond: 1, resolve: 8, label: "Class-blocking AV" },
  "Studio Wi-Fi Not Working": { respond: 1, resolve: 6, label: "Operations blocking" },
  "Booking System Errors": { respond: 0.5, resolve: 6, label: "Revenue blocking" },
  "Payment Processing Delays": { respond: 0.5, resolve: 6, label: "Revenue blocking" },
  "POS System Malfunctions": { respond: 0.5, resolve: 6, label: "Revenue blocking" },
  "Moments Notice": { respond: 0.5, resolve: 8, label: "Core platform" },
  "Auto-Debit Incorrect Charges": { respond: 1, resolve: 24, label: "Financial dispute" },
  "Incorrect Charges on Account": { respond: 1, resolve: 24, label: "Financial dispute" },
  "Refund and Cancellation Policy Issue": { respond: 2, resolve: 48, label: "Financial dispute" },
  "Auto-Renewal Concerns": { respond: 2, resolve: 48, label: "Retention risk" },
  "Trainer Punctuality Issues": { respond: 2, resolve: 24, label: "Service recovery" },
  "Trainer Behaviour": { respond: 1, resolve: 24, label: "Conduct review" },
  "Trainer Hygiene": { respond: 2, resolve: 24, label: "Conduct review" },
  "Injury Prevention and Safety": { respond: 0.5, resolve: 8, label: "Member safety" },
  "Overcrowding in Class": { respond: 4, resolve: 24, label: "Capacity control" },
  "Delay in Response": { respond: 1, resolve: 12, label: "Service recovery" },
  "Unresolved Complaints": { respond: 1, resolve: 12, label: "Escalated complaint" },
  "Front Desk Attitude": { respond: 2, resolve: 24, label: "Conduct review" },
  "Last-minute Cancellations": { respond: 2, resolve: 12, label: "Member impact" },
  "Class Substitutions": { respond: 4, resolve: 24, label: "Member impact" },
  "Data Security Issues": { respond: 0.5, resolve: 8, label: "Data protection" },
  "Data Breach Concerns": { respond: 0.25, resolve: 4, label: "Data protection" },
};

/** Severity multipliers compress or extend the base clock. */
const SEVERITY_FACTOR: Record<Severity, number> = {
  Severe: 0.35,
  Major: 0.6,
  Moderate: 1,
  Minor: 1.6,
};

/**
 * Targets people can actually work to. A multiplier produces values like
 * "7.25h respond / 14.5h resolve", which nobody schedules against and which
 * makes the clock look computed rather than agreed — so the scaled value is
 * snapped down to the nearest real commitment.
 */
const RESPOND_TIERS = [0.25, 0.5, 1, 2, 4, 8, 12, 24];
const RESOLVE_TIERS = [1, 2, 4, 8, 12, 24, 48, 72, 96, 168];

function snap(hours: number, tiers: number[]): number {
  // Round DOWN to a tier so a compressed clock is never quietly loosened;
  // anything under the smallest tier keeps that tier as its floor.
  const eligible = tiers.filter((t) => t <= hours + 1e-9);
  return eligible.length ? eligible[eligible.length - 1] : tiers[0];
}

export type SlaOverrides = Record<string, { respond?: number; resolve?: number }>;

export function basePolicy(category: string, subcategory: string, overrides?: SlaOverrides): SlaPolicy {
  const base =
    SUBCATEGORY_SLA[subcategory] ??
    CATEGORY_SLA[category] ?? { respond: 8, resolve: 72, label: "Standard" };
  const override = overrides?.[category];
  if (!override) return base;
  return {
    ...base,
    respond: override.respond ?? base.respond,
    resolve: override.resolve ?? base.resolve,
  };
}

export type SlaResult = {
  respondHours: number;
  resolveHours: number;
  policyLabel: string;
  severity: Severity;
  priority: Priority;
  reason: string;
};

const SEVERITY_TO_PRIORITY: Record<Severity, Priority> = {
  Severe: "Critical",
  Major: "High",
  Moderate: "Medium",
  Minor: "Low",
};

/** Derive severity from AI signals, then compute the SLA clock. */
export function computeSla(input: {
  category: string;
  subcategory: string;
  urgencyScore: number;
  churnRisk: string;
  sentiment: string;
  impact?: string;
  atRisk?: boolean;
  /** True when confirmed fixed, false when confirmed still happening, undefined when unknown. */
  resolvedNow?: boolean;
  /** Scheduled work announced in advance — a plan to diarise, not a fault to fix. */
  plannedWork?: boolean;
  overrides?: SlaOverrides;
}): SlaResult {
  const policy = basePolicy(input.category, input.subcategory, input.overrides);
  const reasons: string[] = [`${policy.label} policy (${policy.resolve}h base)`];

  let sevIndex = 1; // Moderate
  if (input.urgencyScore >= 88) sevIndex = 3;
  else if (input.urgencyScore >= 70) sevIndex = 2;
  else if (input.urgencyScore <= 35) sevIndex = 0;
  reasons.push(`urgency ${input.urgencyScore}/100`);

  if (input.atRisk) {
    sevIndex = 3;
    reasons.push("immediate risk flagged");
  }
  if (input.impact === "safety") {
    sevIndex = Math.max(sevIndex, 3);
    reasons.push("safety impact");
  } else if (input.impact === "many") {
    sevIndex = Math.max(sevIndex, 2);
    reasons.push("multiple members affected");
  } else if (input.impact === "suggestion") {
    sevIndex = Math.min(sevIndex, 1);
  }
  if (input.churnRisk === "High") {
    sevIndex = Math.max(sevIndex, 2);
    reasons.push("high churn risk");
  }
  if (input.sentiment === "Escalated") {
    sevIndex = Math.max(sevIndex, 2);
    reasons.push("escalated tone");
  }
  // A fault the reporter has confirmed is STILL HAPPENING is live work. Writing
  // it up on the same clock as a fault already fixed is the single most
  // misleading thing this function can do.
  if (input.resolvedNow === false) {
    // ...but "live" is not the same as "big". A fault the reporter has told us
    // affects one machine or one member stays Moderate — otherwise every
    // unresolved report in the system is Major, and Major stops meaning
    // anything. The tight respond clock below still applies either way.
    const narrow = input.impact === "single" || input.impact === "suggestion";
    sevIndex = narrow ? Math.max(sevIndex, 1) : Math.max(sevIndex, 2);
    reasons.push(
      narrow
        ? "still unresolved, but limited to a single member or item"
        : "still unresolved at time of report",
    );
  }

  // Scheduled work is diarised, not scrambled on. Unless a genuine hazard is
  // flagged it cannot exceed Moderate, so a renovation notice never lands on an
  // owner's screen with the same clock as a live outage.
  if (input.plannedWork && !input.atRisk && input.impact !== "safety") {
    sevIndex = Math.min(sevIndex, 1);
    reasons.push("scheduled work, not an incident");
  }

  const severity = SEVERITIES[Math.max(0, Math.min(3, sevIndex))];
  const factor = SEVERITY_FACTOR[severity];

  let respondHours = snap(policy.respond * factor, RESPOND_TIERS);
  const resolveHours = snap(policy.resolve * factor, RESOLVE_TIERS);
  // Nobody waits hours to acknowledge something that is happening right now.
  if (input.resolvedNow === false) respondHours = Math.min(respondHours, 1);
  if (input.atRisk || input.impact === "safety") respondHours = Math.min(respondHours, 0.25);

  return {
    respondHours,
    resolveHours: Math.max(resolveHours, respondHours),
    policyLabel: policy.label,
    severity,
    priority: SEVERITY_TO_PRIORITY[severity],
    reason: `${reasons.join(" · ")} → ${severity} severity, ${resolveHours}h resolve target`,
  };
}

export function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h % 1 === 0 ? h : h.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}h`;
  return `${Math.round(h / 24)}d`;
}

export function severityTone(s: string): string {
  return s === "Severe" ? "danger-soft" : s === "Major" ? "warn-soft" : s === "Moderate" ? "accent-soft" : "mint-soft";
}
