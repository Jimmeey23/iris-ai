/**
 * Golden intake cases.
 *
 * These are the regression suite for the intake agent. Each case is a real-shaped
 * report plus what a good ticket must contain. Add a case every time intake gets
 * something wrong in production — that is how the prompt stops regressing.
 */

export type EvalCase = {
  id: string;
  /** What the reporter types first. */
  report: string;
  /** Scripted answers, in order, for whatever the agent asks. */
  answers?: string[];
  expect: {
    /** Any one of these categories is acceptable. */
    category: string[];
    /** Substrings, case-insensitive — at least one must appear in the subcategory. */
    subcategoryLike?: string[];
    minPriority?: "Low" | "Medium" | "High" | "Critical";
    maxPriority?: "Low" | "Medium" | "High" | "Critical";
    /** Slots the agent must have filled without being told twice. */
    slotsFilled?: string[];
    /** Slots it must NOT ask about — asking any of these is a failure. */
    mustNotAsk?: string[];
    /** Upper bound on questions before the draft appears. */
    maxQuestions: number;
    /**
     * Lower bound. A report can be detailed and still have an owner-critical
     * gap; drafting straight past it is a failure, not efficiency.
     */
    minQuestions?: number;
    /** Momence lookups the agent must run (needs a live Momence connection). */
    mustLookUp?: string[];
    /** Substrings that must appear somewhere in title + summary + rootCause. */
    mustMention?: string[];
  };
};

export const EVAL_CASES: EvalCase[] = [
  {
    id: "power-outage-kemps",
    report:
      "HI, there was no electricity at the Studio for an hour at kemps Corner - we had BBB scheduled at 10 am, cycle at 10.30am and FIT at 11 am. Strength lab had electricity so we moved the 10.15 BBB to that room. 1 client showed up for cycle - kv conducted the class - there was no AC in the room and partial lights and no AC. Client insisted on doing the class - portable cooler was provided to conduct the class. 11 am FIT started with no ac & music. at 11.30am the portable cooler was moved",
    expect: {
      category: ["Repair and Maintenance", "Operating Systems", "Safety and Security"],
      subcategoryLike: ["power", "utility", "outage"],
      minPriority: "High",
      slotsFilled: ["studio", "occurredAt", "actionTaken", "trainer", "classInfo"],
      mustNotAsk: ["member", "memberContact", "raisedFor"],
      minQuestions: 1,
      maxQuestions: 3,
      mustMention: ["power", "kemps"],
    },
  },
  {
    id: "trainer-late-single-member",
    report:
      "A member, Priya Shah, complained that the trainer for the 7am Barre 57 at Bandra turned up 12 minutes late and the class was cut short. She's on an annual membership and is quite upset.",
    answers: ["Neha", "First time"],
    // A named member and a named session are exactly what Momence is for.
    expect: {
      category: ["Trainer Feedback", "Class Experience", "Customer Service and Communication"],
      subcategoryLike: ["punctual", "late", "start", "duration", "length"],
      minPriority: "Medium",
      slotsFilled: ["member", "classInfo", "studio", "raisedFor"],
      mustNotAsk: ["studio", "member"],
      maxQuestions: 3,
      mustMention: ["priya"],
    },
  },
  {
    id: "no-music-negation",
    report:
      "There was no music at all in Studio 2 during the 6pm Mat 57 today at Juhu — the speaker just wouldn't connect. Members noticed.",
    expect: {
      category: ["Tech Issues", "Repair and Maintenance", "Class Experience"],
      subcategoryLike: ["audio", "sound", "music", "speaker", "system"],
      slotsFilled: ["studio", "occurredAt", "classInfo"],
      mustNotAsk: ["member", "memberContact"],
      maxQuestions: 2,
      mustMention: ["music"],
    },
  },
  {
    id: "safety-slip-injury",
    report:
      "A member slipped on water near the showers at Kemps Corner about 20 minutes ago and hurt her wrist. We gave first aid. The leak from the shower has been there since yesterday.",
    expect: {
      category: ["Safety and Security", "Repair and Maintenance"],
      subcategoryLike: ["injur", "first aid", "slip", "accident", "plumb", "leak"],
      minPriority: "Critical",
      slotsFilled: ["studio", "occurredAt", "location", "actionTaken"],
      maxQuestions: 3,
      mustMention: ["slip"],
    },
  },
  {
    id: "double-charge-billing",
    report:
      "Member Ritu Malhotra says she was charged twice for her 20-class pack on 2 September — ₹24,000 instead of ₹12,000. She wants a refund today.",
    answers: ["ritu@example.com"],
    expect: {
      category: ["Pricing and Memberships", "Customer Service and Communication"],
      subcategoryLike: ["charge", "billing", "refund", "payment", "double"],
      minPriority: "High",
      slotsFilled: ["member", "amount", "membershipRef"],
      mustNotAsk: ["trainer", "classInfo", "location"],
      maxQuestions: 3,
      mustMention: ["ritu"],
    },
  },
  {
    id: "suggestion-low-priority",
    report:
      "Just an idea — it would be nice to have phone charging points in the lounge at Bandra. A few regulars have mentioned it.",
    expect: {
      category: ["Miscellaneous", "Studio Amenities and Facilities", "Brand Feedback"],
      subcategoryLike: ["charging", "lounge", "amenit", "seating", "decor"],
      maxPriority: "Medium",
      slotsFilled: ["studio", "impact"],
      mustNotAsk: ["trainer", "atRisk", "memberContact"],
      maxQuestions: 2,
    },
  },
  {
    id: "staff-observed-no-member",
    report:
      "I noticed the barre in Studio 1 at Juhu is loose at the wall bracket. Not member specific, nobody has complained yet, but it wobbles.",
    expect: {
      category: ["Repair and Maintenance", "Safety and Security"],
      subcategoryLike: ["equipment", "broken", "maintenance", "hazard"],
      minPriority: "High",
      slotsFilled: ["studio", "location", "raisedFor"],
      mustNotAsk: ["member", "memberContact", "trainer"],
      maxQuestions: 2,
      mustMention: ["barre"],
    },
  },
  {
    // Momence is what turns "the 7pm cycle" into a real session with a real
    // teacher and a real booking count. If the agent will not reach for it
    // here, the integration is decorative.
    id: "momence-session-lookup",
    report:
      "The 7:15pm powerCycle Express at Kemps Corner today was a mess — bikes weren't set up and it started late. Nobody has complained formally yet.",
    expect: {
      category: ["Class Experience", "Repair and Maintenance", "Trainer Feedback", "Scheduling"],
      // Session id resolution is asserted end to end in session-resolution.test.ts,
      // against the production path that also scopes the search by studio.
      slotsFilled: ["studio", "classInfo"],
      mustNotAsk: ["member", "memberContact"],
      maxQuestions: 3,
      mustLookUp: ["find_sessions"],
    },
  },
  {
    id: "correction-mid-conversation",
    report: "The 8am cycle class at Bandra was overcrowded today, about 4 people had no bike.",
    answers: ["Actually it was the 9am class, not 8am"],
    expect: {
      category: ["Class Experience", "Scheduling"],
      subcategoryLike: ["crowd", "capacity", "equipment", "space"],
      slotsFilled: ["studio", "classInfo"],
      maxQuestions: 3,
      mustMention: ["9"],
    },
  },
];
