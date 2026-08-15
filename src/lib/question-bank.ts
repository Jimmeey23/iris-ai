import type { ChatOption } from "./types";
import type { SlotId } from "./dynamic-chat";

/**
 * Situation-specific question overrides. Keyed by subcategory first, then
 * category — so an AC fault and a harassment report never share wording,
 * options or follow-ups.
 */
export type SlotOverride = {
  prompt?: string;
  helper?: string;
  options?: string[];
  placeholder?: string;
};

export type IssueProfile = {
  /** Extra slots this issue type needs, appended after the core plan. */
  extraSlots?: SlotId[];
  /** Slots that make no sense for this issue type. */
  dropSlots?: SlotId[];
  /** Per-slot wording and option overrides. */
  slots?: Partial<Record<SlotId, SlotOverride>>;
  /** Opening line once the classification is confirmed. */
  intro?: string;
};

const opt = (labels: string[]): string[] => labels;

/* ------------------------------------------------------------------ */
/* Subcategory-level profiles                                          */
/* ------------------------------------------------------------------ */

export const SUBCATEGORY_PROFILES: Record<string, IssueProfile> = {
  "AC and HVAC Issues": {
    intro: "Comfort faults empty classes fast — let's get facilities moving.",
    extraSlots: ["classInfo"],
    slots: {
      location: {
        prompt: "Which room is affected?",
        options: opt(["Main studio floor", "Studio 2", "Cycle studio", "Strength Lab floor", "Reception / lobby", "Locker room", "Whole premises"]),
      },
      impact: {
        prompt: "How bad is it in there right now?",
        options: opt([
          "Unusable — class had to move or stop",
          "Members complained and some left",
          "Noticeably uncomfortable",
          "Slightly off, worth a look",
        ]),
      },
      actionTaken: {
        prompt: "Any interim fix in place?",
        helper: "Portable coolers, fans, doors open, class relocated…",
      },
    },
  },
  "Broken Equipment Not Repaired": {
    intro: "Equipment faults are an injury risk — let's log the specifics.",
    extraSlots: ["witnesses"],
    slots: {
      location: { prompt: "Which part of the floor is it on?" },
      impact: {
        prompt: "What's the injury risk here?",
        options: opt([
          "High — someone could get hurt, cordoned off",
          "Medium — usable but degraded",
          "Low — cosmetic only",
          "Already caused an injury",
        ]),
      },
      actionTaken: { prompt: "Have you taken it out of service?", helper: "Cordoned, labelled, moved to storage…" },
      witnesses: { prompt: "Was anyone using it when it failed?", helper: "Name them if so." },
    },
  },
  "Plumbing Leaks": {
    intro: "Water spreads — let's contain this quickly.",
    slots: {
      location: { prompt: "Where's the water coming from?", options: opt(["Showers / washroom", "Locker room", "Reception / lobby", "Studio floor", "Back office", "Ceiling / above"]) },
      impact: {
        prompt: "How much water are we dealing with?",
        options: opt(["Flooding — slip hazard now", "Steady drip into a bucket", "Damp patch only", "Damaging equipment or stock"]),
      },
      actionTaken: { prompt: "Is it contained?", helper: "Mopped, bucket placed, water shut off, area closed…" },
    },
  },
  "Cleanliness and Hygiene": {
    intro: "Cleanliness is the fastest thing members notice — let's log it.",
    slots: {
      location: { prompt: "Which area needs attention?" },
      impact: {
        prompt: "How visible is it to members?",
        options: opt(["Members have already complained", "Very visible in a main area", "Noticeable but tucked away", "Back of house only"]),
      },
      frequency: {
        prompt: "Is this a one-off or slipping regularly?",
        options: opt(["One-off", "Second or third time this month", "Happening most days"]),
      },
    },
  },
  "Trainer Punctuality Issues": {
    intro: "Late starts hit member trust — let's capture the timing properly.",
    extraSlots: ["actionTaken"],
    slots: {
      impact: {
        prompt: "How late were they, and did it cost class time?",
        options: opt([
          "Over 15 minutes — class cut short",
          "5–15 minutes — rushed cooldown",
          "Under 5 minutes — barely noticed",
          "Never arrived — class cancelled",
        ]),
      },
      frequency: {
        prompt: "Is this the first time for this trainer?",
        options: opt(["First occurrence", "Second in 30 days", "Third or more — pattern forming"]),
      },
      actionTaken: { prompt: "What did we do for the members waiting?", helper: "Apology, credit, substitute, warm-up led by desk…" },
    },
  },
  "Trainer Behaviour": {
    intro: "Conduct matters — I'll keep this factual and route it discreetly.",
    extraSlots: ["witnesses", "frequency"],
    slots: {
      impact: {
        prompt: "How serious was it?",
        options: opt([
          "Serious — formal review needed",
          "Members visibly uncomfortable",
          "One-off lapse in tone",
          "Coaching note only",
        ]),
      },
      witnesses: { prompt: "Who else witnessed it?", helper: "Staff or members who could corroborate." },
    },
  },
  "Injury Prevention and Safety": {
    intro: "Safety first — let's get the full picture on record.",
    extraSlots: ["witnesses", "actionTaken"],
    slots: {
      atRisk: { prompt: "Is the member okay right now?", options: opt(["No — still needs attention", "Yes — they're fine now"]) },
      impact: {
        prompt: "What happened to the member?",
        options: opt(["Required medical attention", "Minor injury, first aid given", "Near miss, no injury", "Unsafe technique spotted"]),
      },
      actionTaken: { prompt: "What did you do at the time?", helper: "First aid, stopped the class, called someone…" },
    },
  },
  "Overcrowding in Class": {
    intro: "Capacity issues are usually a booking-rule fix — let's get the numbers.",
    slots: {
      impact: {
        prompt: "How tight was it?",
        options: opt([
          "Unsafe — no space between mats",
          "Members complained about space",
          "Full but manageable",
          "Only slightly over",
        ]),
      },
      amount: { prompt: "Booked versus capacity?", placeholder: "e.g. 26 booked into 22 spots", helper: "Momence numbers if you have them." },
    },
  },
  "Refund and Cancellation Policy Issue": {
    intro: "Let's get Accounts everything they need to action this in one pass.",
    extraSlots: ["amount", "frequency"],
    slots: {
      amount: { prompt: "How much is in dispute?", placeholder: "e.g. ₹12,500 charged on 5 Aug" },
      impact: {
        prompt: "Where is the member's head at?",
        options: opt([
          "Threatening a chargeback or legal",
          "Has asked to cancel their membership",
          "Frustrated but will stay if fixed",
          "Just wants clarity",
        ]),
      },
      frequency: {
        prompt: "Has billing gone wrong for them before?",
        options: opt(["First time", "Happened once before", "Repeated billing problems"]),
      },
    },
  },
  "Auto-Renewal Concerns": {
    intro: "Renewal disputes are retention risks — let's be precise.",
    extraSlots: ["amount"],
    slots: {
      amount: { prompt: "What was charged and when?", placeholder: "e.g. ₹18,000 on 5 Aug" },
      impact: {
        prompt: "What outcome does the member want?",
        options: opt(["Full reversal", "Cancel going forward", "Pause instead of renew", "Just an explanation"]),
      },
    },
  },
  "Locker Theft": {
    intro: "I'll treat this as a security incident — let's capture it for the investigation.",
    extraSlots: ["witnesses", "amount", "actionTaken"],
    slots: {
      amount: { prompt: "Roughly what's the value of what's missing?", placeholder: "e.g. gold earrings, approx ₹40,000" },
      atRisk: { prompt: "Is the member still on site?", options: opt(["Yes — they're waiting", "No — they've left"]) },
      actionTaken: { prompt: "Has CCTV been pulled yet?", helper: "Footage window, who reviewed it, locker number." },
      witnesses: { prompt: "Who else was in the locker room in that window?" },
    },
  },
  "Stolen Personal Items": {
    intro: "Let's document this properly for the theft protocol.",
    extraSlots: ["witnesses", "amount", "actionTaken"],
    slots: {
      amount: { prompt: "What's missing and roughly what's it worth?" },
      actionTaken: { prompt: "What have you already checked?", helper: "Lost and found, CCTV, staff asked…" },
    },
  },
  "Handling of Medical Emergencies": {
    intro: "Let's get this on record fast and accurately.",
    extraSlots: ["witnesses", "actionTaken"],
    slots: {
      atRisk: {
        prompt: "Is the person stable right now?",
        options: opt(["No — emergency ongoing", "Stable but needs follow-up", "Fully recovered on site"]),
      },
      impact: {
        prompt: "What level of care was needed?",
        options: opt(["Ambulance called", "Advised to see a doctor", "First aid on site only", "No treatment needed"]),
      },
      actionTaken: { prompt: "Walk me through what was done.", helper: "First aid, who administered, who was called." },
      location: { prompt: "Where did it happen?" },
    },
  },
  "Emergency Exits Blocked": {
    intro: "That's a compliance breach — flagging it as urgent.",
    extraSlots: ["actionTaken"],
    slots: {
      atRisk: { prompt: "Is the exit still blocked right now?", options: opt(["Yes — blocked as we speak", "No — already cleared"]) },
      location: { prompt: "Which exit?", options: opt(["Rear fire exit", "Main entrance", "Side corridor", "Stairwell", "Basement / parking exit"]) },
      actionTaken: { prompt: "Has it been cleared?", helper: "Who moved it, where to, when." },
    },
  },
  "Client Harassment Reports": {
    intro: "Thank you for reporting this. I'll keep it confidential and route it to leadership only.",
    extraSlots: ["witnesses", "actionTaken"],
    slots: {
      atRisk: { prompt: "Is the person safe right now?", options: opt(["No — needs immediate intervention", "Yes — but shaken", "Yes — situation defused"]) },
      impact: {
        prompt: "What kind of conduct are we dealing with?",
        options: opt(["Physical", "Verbal / threatening", "Persistent unwanted attention", "Inappropriate comments"]),
      },
      witnesses: { prompt: "Who witnessed this?", helper: "Names only — statements can follow." },
      actionTaken: { prompt: "What was done at the time?", helper: "Separated, asked to leave, security called…" },
    },
  },
  "Mic Not Working": {
    intro: "AV faults kill a class — let's get IT on it.",
    slots: {
      systemAffected: { prompt: "Which piece of kit exactly?", options: opt(["Headset mic", "Handheld mic", "Receiver / base unit", "Speakers", "Mixer / amp"]) },
      impact: {
        prompt: "Could the trainer still run the class?",
        options: opt(["No — class was compromised", "Yes — shouted over the music", "Yes — backup mic worked", "Only intermittent"]),
      },
      actionTaken: { prompt: "Tried a battery swap or the backup?", helper: "Saves IT repeating your steps." },
    },
  },
  "Studio Wi-Fi Not Working": {
    intro: "Let's find out how much of the operation is blocked.",
    slots: {
      impact: {
        prompt: "What's it stopping you doing?",
        options: opt(["Can't check members in at all", "Payments failing", "Slow but working", "Only affects staff devices"]),
      },
      actionTaken: { prompt: "Rebooted the router yet?", helper: "And did it come back?" },
    },
  },
  "Moments Notice": {
    intro: "Momence is core to the day — let's give the vendor a clean report.",
    slots: {
      impact: {
        prompt: "What's broken in the workflow?",
        options: opt(["Check-ins blocked", "Bookings not showing", "Payments failing", "Reporting or data wrong", "Cosmetic glitch"]),
      },
      actionTaken: { prompt: "Any error message on screen?", placeholder: "Copy the exact wording if you can" },
    },
  },
  "Delay in Response": {
    intro: "Response gaps compound — let's get an owner on it today.",
    extraSlots: ["frequency"],
    slots: {
      impact: {
        prompt: "How long have they been waiting?",
        options: opt(["Over a week", "3–5 days", "1–2 days", "Under 24 hours"]),
      },
      frequency: {
        prompt: "Have they chased us more than once?",
        options: opt(["Chased three or more times", "Chased twice", "First follow-up"]),
      },
      actionTaken: { prompt: "Has anyone acknowledged them yet?" },
    },
  },
  "Front Desk Attitude": {
    intro: "Front desk is our first impression — let's log this factually.",
    extraSlots: ["witnesses"],
    slots: {
      impact: {
        prompt: "How did the member react?",
        options: opt(["Left upset / threatened to cancel", "Visibly annoyed", "Mentioned it in passing", "Raised it calmly as feedback"]),
      },
      witnesses: { prompt: "Who else was at the desk?" },
    },
  },
  "Additional Classes": {
    intro: "Demand signals are gold for the timetable — let's quantify it.",
    dropSlots: ["atRisk", "actionTaken"],
    slots: {
      amount: { prompt: "How many members have asked?", placeholder: "e.g. 4 this week" },
      impact: {
        prompt: "How strong is the demand?",
        options: opt(["Existing slot is full every week", "Several members asking", "A couple of requests", "One member's idea"]),
      },
      occurredAt: { prompt: "Over what period have these requests come in?" },
    },
  },
  "Class Capacity Issues": {
    dropSlots: ["atRisk"],
    slots: {
      amount: { prompt: "What are the numbers?", placeholder: "e.g. 30 on waitlist for a 22-spot class" },
    },
  },
};

/* ------------------------------------------------------------------ */
/* Category-level fallbacks                                            */
/* ------------------------------------------------------------------ */

export const CATEGORY_PROFILES: Record<string, IssueProfile> = {
  "Safety and Security": {
    intro: "Safety cases jump the queue — I'll keep this tight.",
    extraSlots: ["atRisk", "witnesses", "actionTaken"],
    slots: {
      impact: {
        prompt: "How severe is the situation?",
        options: opt(["Immediate danger to someone", "Several people exposed to risk", "One person affected", "Potential risk, nobody harmed yet"]),
      },
    },
  },
  "Theft and Lost Items": {
    intro: "Let's build a clean record for the investigation.",
    extraSlots: ["amount", "witnesses", "actionTaken"],
    slots: {
      impact: {
        prompt: "How significant is the loss?",
        options: opt(["High value or sentimental", "Moderate value", "Low value", "Item likely just misplaced"]),
      },
    },
  },
  "Pricing and Memberships": {
    intro: "Accounts will need the figures — let's gather them in one go.",
    dropSlots: ["location", "atRisk"],
    extraSlots: ["amount"],
    slots: {
      impact: {
        prompt: "What's the retention risk here?",
        options: opt(["Likely to cancel", "Considering leaving", "Annoyed but staying", "Just wants clarity"]),
      },
    },
  },
  "Repair and Maintenance": {
    intro: "Let's give facilities enough to fix it first time.",
    extraSlots: ["actionTaken"],
    slots: {
      impact: {
        prompt: "Is it stopping us running classes?",
        options: opt(["Yes — classes affected now", "Members noticing and complaining", "Workable for now", "Cosmetic only"]),
      },
    },
  },
  "Trainer Feedback": {
    intro: "This feeds straight into their performance profile.",
    extraSlots: ["frequency"],
    dropSlots: ["systemAffected"],
  },
  "Class Experience": {
    intro: "Let's pin down what happened in the room.",
    dropSlots: ["systemAffected"],
  },
  "Customer Service and Communication": {
    intro: "Service recovery works best when it's fast — let's log it now.",
    dropSlots: ["location", "atRisk"],
    extraSlots: ["frequency", "actionTaken"],
  },
  "Tech Issues": {
    intro: "Let's give IT a reproducible report.",
    extraSlots: ["actionTaken"],
  },
  "Operating Systems": {
    intro: "Platform faults need detail for the vendor ticket.",
    extraSlots: ["actionTaken"],
    dropSlots: ["location"],
  },
  Scheduling: {
    intro: "Timetable changes need demand evidence — let's capture it.",
    dropSlots: ["atRisk", "location", "systemAffected"],
  },
  "Brand Feedback": {
    intro: "I'll route this to Marketing with the context.",
    dropSlots: ["atRisk", "systemAffected", "actionTaken"],
  },
  "Studio Amenities and Facilities": {
    intro: "Amenity issues shape how the studio feels — let's log it.",
    extraSlots: ["frequency"],
  },
  Miscellaneous: {
    intro: "Let's get the details down.",
  },
};

export function profileFor(category: string, subcategory: string): IssueProfile {
  const sub = SUBCATEGORY_PROFILES[subcategory];
  const cat = CATEGORY_PROFILES[category] ?? {};
  if (!sub) return cat;
  return {
    intro: sub.intro ?? cat.intro,
    extraSlots: [...(cat.extraSlots ?? []), ...(sub.extraSlots ?? [])],
    dropSlots: [...(cat.dropSlots ?? []), ...(sub.dropSlots ?? [])],
    slots: { ...(cat.slots ?? {}), ...(sub.slots ?? {}) },
  };
}

export function overrideToOptions(prefix: string, labels: string[]): ChatOption[] {
  return labels.map((l) => ({ label: l, value: `${prefix}:${l}` }));
}
