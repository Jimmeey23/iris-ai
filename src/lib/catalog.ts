/** Physique 57 membership & package catalogue (mirrors Momence products). */
export const MEMBERSHIPS: string[] = [
  "Barre 1 month Unlimited",
  "Barre 2 week Unlimited",
  "Barre 3 months Unlimited",
  "Barre 6 month Unlimited",
  "Barre Annual Membership",
  "Newcomers 2 For 1",
  "Owner's Special - 2 for 1",
  "powerCycle 1 month Unlimited",
  "powerCycle 2 week Unlimited",
  "powerCycle 3 months Unlimited",
  "powerCycle 6 months Unlimited",
  "powerCycle Annual Membership",
  "Strength Lab 1 month Unlimited",
  "Strength Lab 2 week Unlimited",
  "Strength Lab 3 months Unlimited",
  "Strength Lab 6 months Unlimited",
  "Strength Lab Annual Membership",
  "Studio 1 Month Unlimited Membership",
  "Studio 10 Single Class Pack",
  "Studio 12 Class Package",
  "Studio 2 Week Unlimited Membership",
  "Studio 20 Single Class Pack",
  "Studio 3 Month U/L Monthly Installment",
  "Studio 3 Month Unlimited Membership",
  "Studio 30 Single Class Pack",
  "Studio 4 Class Package",
  "Studio 6 Month Unlimited Membership",
  "Studio 8 Class Package",
  "Studio Annual Membership - Monthly Intsallment",
  "Studio Annual Unlimited Membership",
  "Studio Extended 10 Single Class Pack",
  "Studio Happy Hour Private",
  "Studio Newcomers 2 Week Unlimited Membership",
  "Studio Private - Anisha (Single Class)",
  "Studio Private Class",
  "Studio Private Class X 10",
  "Studio Privates - Anisha x 10",
  "Studio Single Class",
  "Summer Bootcamp - Studio 6 Week Unlimited",
  "Virtual Private - Anisha",
  "Virtual Private Class",
  "Virtual Private Class X 10",
  "Virtual Privates - Anisha x 10",
];

export const MEMBERSHIP_GROUPS: { label: string; items: string[] }[] = [
  { label: "Barre", items: MEMBERSHIPS.filter((m) => m.startsWith("Barre")) },
  { label: "powerCycle", items: MEMBERSHIPS.filter((m) => m.startsWith("powerCycle")) },
  { label: "Strength Lab", items: MEMBERSHIPS.filter((m) => m.startsWith("Strength Lab")) },
  { label: "Studio", items: MEMBERSHIPS.filter((m) => m.startsWith("Studio")) },
  { label: "Virtual & Private", items: MEMBERSHIPS.filter((m) => m.startsWith("Virtual")) },
  {
    label: "Offers",
    items: MEMBERSHIPS.filter(
      (m) => m.startsWith("Newcomers") || m.startsWith("Owner's") || m.startsWith("Summer"),
    ),
  },
];

export const CLASS_FORMATS = [
  "Barre 57",
  "Studio Barre 57",
  "Cardio Barre",
  "Studio Cardio Barre Express",
  "Studio FIT",
  "Strength Lab",
  "powerCycle",
  "Mat 57",
  "Studio Recovery",
  "Private Session",
  "Hosted / Community Class",
  "Not class specific",
];

export const STUDIO_AREAS = [
  "Main studio floor",
  "Studio 2",
  "Cycle studio",
  "Strength Lab floor",
  "Reception / lobby",
  "Locker room",
  "Showers / washroom",
  "Member lounge",
  "Boutique",
  "Parking / valet",
  "Back office",
  "Staircase / corridor",
];

export const SYSTEMS = [
  "Momence",
  "POS / card machine",
  "Wi-Fi / router",
  "Front desk iPad",
  "Website / mobile app",
  "Payment gateway (Stripe / Razorpay)",
  "Audio / mic system",
  "CCTV / surveillance",
  "Access control / door lock",
  "Cash counting machine",
  "Other system",
];

export const OCCURRED_OPTIONS = [
  "Just now",
  "Earlier today",
  "Yesterday",
  "Earlier this week",
  "Last week",
  "Ongoing / recurring",
];

export const TRAINER_TEMPLATES = ["Barre", "powerCycle", "Strength Lab", "General"] as const;
export type TrainerTemplate = (typeof TRAINER_TEMPLATES)[number];
