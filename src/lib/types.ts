import type { Priority } from "./taxonomy";

export type MomenceContext = {
  memberId?: number;
  memberEmail?: string;
  memberPhone?: string;
  memberSince?: string;
  memberVisits?: number;
  lastVisit?: string;
  sessionId?: number;
  sessionName?: string;
  sessionStart?: string;
  sessionTeacher?: string;
  sessionLocation?: string;
  memberships?: string[];
  creditsLeft?: number | null;
};

export type TicketDraft = {
  category: string;
  subcategory: string;
  title: string;
  summary: string;
  description: string;
  priority: Priority;
  studioId: number | null;
  studioName: string;
  reportedBy: string;
  reportedByRole: string;
  raisedFor: string;
  memberName?: string;
  memberContact?: string;
  momenceMemberId?: number;
  momenceSessionId?: number;
  membershipRef?: string;
  trainerName?: string;
  classInfo?: string;
  classAt?: string;
  location?: string;
  systemAffected?: string;
  occurredAt?: string;
  impact?: string;
  sentiment: string;
  emotion: string;
  urgencyScore: number;
  churnRisk: string;
  effort: string;
  rootCause: string;
  suggestedAction: string;
  aiConfidence: number;
  aiEngine: string;
  severity: string;
  slaRespondHours: number;
  slaResolveHours: number;
  slaPolicy: string;
  slaReason: string;
  department: string;
  tags: string[];
  details: Record<string, string>;
  momenceContext?: MomenceContext;
  source: string;
  priorityReason?: string;
  /** Set when this draft is a child split out of a multi-issue report. */
  parentTicketId?: number;
  /** Other problems the same report surfaced, raised as linked tickets on approval. */
  secondaryIssues?: SecondaryIssue[];
};

export type SecondaryIssue = {
  title: string;
  category: string;
  subcategory: string;
  summary: string;
};

export type ChatOption = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "primary" | "danger" | "ghost";
};

export type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  createdAt: string;
  options?: ChatOption[];
  allowFreeText?: boolean;
  placeholder?: string;
  picker?: "member" | "session" | "trainer" | "studio" | "membership";
  remaining?: number;
  kind?: "text" | "draft" | "created" | "thinking";
  draft?: TicketDraft;
  created?: {
    id: number;
    ticketNumber: string;
    assigneeName: string | null;
    assigneeTeam: string | null;
    assigneeEmail: string | null;
    assignmentReason: string | null;
    slaDueAt: string | null;
    priority: string;
  };
  analysis?: { label: string; value: string; tone?: string }[];
  inferred?: string[];
};

/** Context attached from the composer context bar before the first message. */
export type ComposerContext = {
  studioId?: number | null;
  studioName?: string;
  memberId?: number;
  memberName?: string;
  memberContact?: string;
  trainerName?: string;
  classInfo?: string;
  classAt?: string;
  sessionId?: number;
  membershipRef?: string;
  category?: string;
  subcategory?: string;
  raisedFor?: string;
  occurredAt?: string;
  location?: string;
  impact?: string;
  priority?: string;
  department?: string;
  source?: string;
  tags?: string[];
  momenceContext?: MomenceContext;
};
