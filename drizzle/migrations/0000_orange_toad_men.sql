CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "class_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer,
	"momence_session_id" integer,
	"session_name" text DEFAULT '' NOT NULL,
	"session_start" text,
	"host_name" text DEFAULT '' NOT NULL,
	"trainer_name" text DEFAULT '' NOT NULL,
	"studio_name" text DEFAULT '' NOT NULL,
	"attendee_count" integer DEFAULT 0 NOT NULL,
	"host_score" integer DEFAULT 0 NOT NULL,
	"class_score" integer DEFAULT 0 NOT NULL,
	"audience_relevance" text DEFAULT '' NOT NULL,
	"purchase_intent" text DEFAULT '' NOT NULL,
	"conversion_count" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recorded_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"blurb" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT '▤' NOT NULL,
	"group_name" text DEFAULT 'Facilities' NOT NULL,
	"category" text NOT NULL,
	"subcategory" text NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"raised_for" text DEFAULT 'Noticed by staff' NOT NULL,
	"kind" text DEFAULT 'form' NOT NULL,
	"embed_id" text,
	"embed_kind" text,
	"embed_height" integer DEFAULT 600 NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"department" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"manager" text DEFAULT '' NOT NULL,
	"studio_id" integer,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avatar_color" text DEFAULT '#6366f1' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "staff_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "studios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"city" text NOT NULL,
	"momence_location_id" integer,
	"is_hq" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"type" text DEFAULT 'comment' NOT NULL,
	"actor" text DEFAULT 'System' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"subcategory" text NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"status" text DEFAULT 'Open' NOT NULL,
	"studio_id" integer,
	"studio_name" text DEFAULT 'Not studio specific' NOT NULL,
	"source" text DEFAULT 'AI Assistant' NOT NULL,
	"reported_by" text DEFAULT 'Internal Team' NOT NULL,
	"reported_by_role" text DEFAULT '' NOT NULL,
	"raised_for" text DEFAULT 'Noticed by staff' NOT NULL,
	"member_name" text,
	"member_contact" text,
	"momence_member_id" integer,
	"momence_session_id" integer,
	"membership_ref" text,
	"trainer_name" text,
	"class_info" text,
	"class_at" text,
	"location" text,
	"system_affected" text,
	"occurred_at" text,
	"impact" text,
	"sentiment" text DEFAULT 'Neutral' NOT NULL,
	"emotion" text DEFAULT 'Informational' NOT NULL,
	"urgency_score" integer DEFAULT 50 NOT NULL,
	"churn_risk" text DEFAULT 'Low' NOT NULL,
	"effort" text DEFAULT 'Medium' NOT NULL,
	"root_cause" text,
	"suggested_action" text,
	"ai_confidence" integer DEFAULT 70 NOT NULL,
	"ai_engine" text DEFAULT 'Iris NLU' NOT NULL,
	"department" text DEFAULT 'Operations' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"momence_context" jsonb,
	"assignee_id" integer,
	"assignee_name" text,
	"assignee_team" text,
	"assignee_email" text,
	"watchers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sla_hours" integer DEFAULT 72 NOT NULL,
	"sla_reason" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'Moderate' NOT NULL,
	"first_response_at" timestamp with time zone,
	"assignment_reason" text,
	"sla_due_at" timestamp with time zone,
	"resolution_notes" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_ticket_number_unique" UNIQUE("ticket_number")
);
--> statement-breakpoint
CREATE TABLE "trainer_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_ref" text NOT NULL,
	"trainer_id" integer,
	"trainer_name" text NOT NULL,
	"template" text DEFAULT 'Barre' NOT NULL,
	"studio" text DEFAULT '' NOT NULL,
	"class_type" text,
	"evaluator" text DEFAULT '' NOT NULL,
	"score_percent" integer DEFAULT 0 NOT NULL,
	"band" text DEFAULT 'On-track performance' NOT NULL,
	"scores" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"improvements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus_points" text DEFAULT '' NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"comments" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'fillout' NOT NULL,
	"submission_id" text,
	"form_id" text,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainer_evaluations_source_ref_unique" UNIQUE("source_ref")
);
--> statement-breakpoint
CREATE TABLE "trainers" (
	"id" serial PRIMARY KEY NOT NULL,
	"momence_teacher_id" integer,
	"name" text NOT NULL,
	"email" text,
	"picture_url" text,
	"home_studio" text DEFAULT '' NOT NULL,
	"formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"joined_at" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "class_feedback_ticket_id_idx" ON "class_feedback" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_id_idx" ON "ticket_events" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_assignee_id_idx" ON "tickets" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tickets_studio_id_idx" ON "tickets" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "tickets_category_idx" ON "tickets" USING btree ("category");