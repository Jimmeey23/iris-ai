import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const studios = pgTable("studios", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  city: text("city").notNull(),
  momenceLocationId: integer("momence_location_id"),
  isHq: boolean("is_hq").notNull().default(false),
});

export const departments = pgTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  active: boolean("active").notNull().default(true),
});

export const staff = pgTable("staff", {
  id: serial("id").primaryKey(),
  externalId: text("external_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  role: text("role").notNull(),
  department: text("department").notNull(),
  location: text("location").notNull().default(""),
  manager: text("manager").notNull().default(""),
  studioId: integer("studio_id"),
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  avatarColor: text("avatar_color").notNull().default("#6366f1"),
  isActive: boolean("is_active").notNull().default(true),
});

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  ticketNumber: text("ticket_number").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  description: text("description").notNull().default(""),
  category: text("category").notNull(),
  subcategory: text("subcategory").notNull(),
  priority: text("priority").notNull().default("Medium"),
  status: text("status").notNull().default("Open"),
  studioId: integer("studio_id"),
  studioName: text("studio_name").notNull().default("Not studio specific"),
  source: text("source").notNull().default("AI Assistant"),
  reportedBy: text("reported_by").notNull().default("Internal Team"),
  reportedByRole: text("reported_by_role").notNull().default(""),
  raisedFor: text("raised_for").notNull().default("Noticed by staff"),
  memberName: text("member_name"),
  memberContact: text("member_contact"),
  momenceMemberId: integer("momence_member_id"),
  momenceSessionId: integer("momence_session_id"),
  membershipRef: text("membership_ref"),
  trainerName: text("trainer_name"),
  classInfo: text("class_info"),
  classAt: text("class_at"),
  location: text("location"),
  systemAffected: text("system_affected"),
  occurredAt: text("occurred_at"),
  impact: text("impact"),
  sentiment: text("sentiment").notNull().default("Neutral"),
  emotion: text("emotion").notNull().default("Informational"),
  urgencyScore: integer("urgency_score").notNull().default(50),
  churnRisk: text("churn_risk").notNull().default("Low"),
  effort: text("effort").notNull().default("Medium"),
  rootCause: text("root_cause"),
  suggestedAction: text("suggested_action"),
  aiConfidence: integer("ai_confidence").notNull().default(70),
  aiEngine: text("ai_engine").notNull().default("Iris NLU"),
  department: text("department").notNull().default("Operations"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  details: jsonb("details").$type<Record<string, string>>().notNull().default({}),
  momenceContext: jsonb("momence_context").$type<Record<string, unknown>>(),
  assigneeId: integer("assignee_id"),
  assigneeName: text("assignee_name"),
  assigneeTeam: text("assignee_team"),
  assigneeEmail: text("assignee_email"),
  watchers: jsonb("watchers").$type<string[]>().notNull().default([]),
  slaHours: integer("sla_hours").notNull().default(72),
  slaReason: text("sla_reason").notNull().default(""),
  severity: text("severity").notNull().default("Moderate"),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  assignmentReason: text("assignment_reason"),
  slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tickets_status_idx").on(t.status),
  index("tickets_assignee_id_idx").on(t.assigneeId),
  index("tickets_studio_id_idx").on(t.studioId),
  index("tickets_category_idx").on(t.category),
]);

export const ticketEvents = pgTable("ticket_events", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  type: text("type").notNull().default("comment"),
  actor: text("actor").notNull().default("System"),
  message: text("message").notNull().default(""),
  meta: jsonb("meta").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ticket_events_ticket_id_idx").on(t.ticketId)]);

export const trainers = pgTable("trainers", {
  id: serial("id").primaryKey(),
  momenceTeacherId: integer("momence_teacher_id"),
  name: text("name").notNull(),
  email: text("email"),
  pictureUrl: text("picture_url"),
  homeStudio: text("home_studio").notNull().default(""),
  formats: jsonb("formats").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("Active"),
  joinedAt: text("joined_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainerEvaluations = pgTable("trainer_evaluations", {
  id: serial("id").primaryKey(),
  sourceRef: text("source_ref").notNull().unique(),
  trainerId: integer("trainer_id"),
  trainerName: text("trainer_name").notNull(),
  template: text("template").notNull().default("Barre"),
  studio: text("studio").notNull().default(""),
  classType: text("class_type"),
  evaluator: text("evaluator").notNull().default(""),
  scorePercent: integer("score_percent").notNull().default(0),
  band: text("band").notNull().default("On-track performance"),
  scores: jsonb("scores").$type<{ category: string; score: number; weightage: number }[]>().notNull().default([]),
  strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
  improvements: jsonb("improvements").$type<string[]>().notNull().default([]),
  focusPoints: text("focus_points").notNull().default(""),
  goals: text("goals").notNull().default(""),
  comments: text("comments").notNull().default(""),
  source: text("source").notNull().default("fillout"),
  submissionId: text("submission_id"),
  formId: text("form_id"),
  answers: jsonb("answers").$type<{ label: string; value: string }[]>().notNull().default([]),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const classFeedback = pgTable("class_feedback", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id"),
  momenceSessionId: integer("momence_session_id"),
  sessionName: text("session_name").notNull().default(""),
  sessionStart: text("session_start"),
  hostName: text("host_name").notNull().default(""),
  trainerName: text("trainer_name").notNull().default(""),
  studioName: text("studio_name").notNull().default(""),
  attendeeCount: integer("attendee_count").notNull().default(0),
  hostScore: integer("host_score").notNull().default(0),
  classScore: integer("class_score").notNull().default(0),
  audienceRelevance: text("audience_relevance").notNull().default(""),
  purchaseIntent: text("purchase_intent").notNull().default(""),
  conversionCount: integer("conversion_count").notNull().default(0),
  notes: text("notes").notNull().default(""),
  attendees: jsonb("attendees").$type<Record<string, unknown>[]>().notNull().default([]),
  recordedBy: text("recorded_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("class_feedback_ticket_id_idx").on(t.ticketId)]);

export const chatSessions = pgTable("chat_sessions", {
  id: text("id").primaryKey(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  transcript: jsonb("transcript").$type<unknown[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customTemplates = pgTable("custom_templates", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  blurb: text("blurb").notNull().default(""),
  icon: text("icon").notNull().default("▤"),
  group: text("group_name").notNull().default("Facilities"),
  category: text("category").notNull(),
  subcategory: text("subcategory").notNull(),
  priority: text("priority").notNull().default("Medium"),
  raisedFor: text("raised_for").notNull().default("Noticed by staff"),
  kind: text("kind").notNull().default("form"),
  embedId: text("embed_id"),
  embedKind: text("embed_kind"),
  embedHeight: integer("embed_height").notNull().default(600),
  fields: jsonb("fields").$type<Record<string, unknown>[]>().notNull().default([]),
  createdBy: text("created_by").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customFilloutForms = pgTable("custom_fillout_forms", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  blurb: text("blurb").notNull().default(""),
  template: text("template").notNull().default("General"),
  embedId: text("embed_id").notNull(),
  embedKind: text("embed_kind").notNull().default("fillout-v1"),
  height: integer("height").notNull().default(500),
  icon: text("icon").notNull().default("▤"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainerAnalysis = pgTable("trainer_analysis", {
  trainerId: integer("trainer_id").primaryKey(),
  headline: text("headline").notNull().default(""),
  narrative: text("narrative").notNull().default(""),
  strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
  priorities: jsonb("priorities").$type<string[]>().notNull().default([]),
  coachingPlan: jsonb("coaching_plan").$type<{ horizon: string; action: string }[]>().notNull().default([]),
  trajectory: text("trajectory").notNull().default(""),
  risk: text("risk").notNull().default("stable"),
  engine: text("engine").notNull().default(""),
  evalCount: integer("eval_count").notNull().default(0),
  latestEvalId: integer("latest_eval_id"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Links a Supabase Auth user to an access-control role and (optionally) a staff record. */
export const userAccounts = pgTable("user_accounts", {
  id: serial("id").primaryKey(),
  authUserId: text("auth_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default("executive"), // "admin" | "manager" | "executive"
  department: text("department").notNull().default(""),
  staffId: integer("staff_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: serial("id").primaryKey(),
  templateId: text("template_id").notNull().unique(),
  name: text("name").notNull(),
  label: text("label"),
  languageCode: text("language_code").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("approved"),
  channelId: integer("channel_id").notNull(),
  components: jsonb("components").$type<Record<string, unknown>[]>().notNull().default([]),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type Staff = typeof staff.$inferSelect;
export type Studio = typeof studios.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type TicketEvent = typeof ticketEvents.$inferSelect;
export type Trainer = typeof trainers.$inferSelect;
export type TrainerEvaluation = typeof trainerEvaluations.$inferSelect;
export type ClassFeedback = typeof classFeedback.$inferSelect;
export type CustomTemplate = typeof customTemplates.$inferSelect;
export type CustomFilloutForm = typeof customFilloutForms.$inferSelect;
export type TrainerAnalysis = typeof trainerAnalysis.$inferSelect;
export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type UserAccount = typeof userAccounts.$inferSelect;
