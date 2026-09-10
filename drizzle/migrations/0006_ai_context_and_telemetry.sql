ALTER TABLE "tickets" ADD COLUMN "embedding" jsonb;--> statement-breakpoint
CREATE TABLE "ai_calls" (
  "id" serial PRIMARY KEY,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "feature" text DEFAULT 'unknown' NOT NULL,
  "model" text,
  "ok" boolean NOT NULL,
  "error" text,
  "latency_ms" integer,
  "input_tokens" integer,
  "output_tokens" integer,
  "session_id" text
);--> statement-breakpoint
CREATE INDEX "ai_calls_created_at_idx" ON "ai_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_feature_idx" ON "ai_calls" USING btree ("feature");--> statement-breakpoint
CREATE TABLE "context_facts" (
  "id" serial PRIMARY KEY,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "scope" text DEFAULT 'studio' NOT NULL,
  "ref_key" text NOT NULL,
  "fact" text NOT NULL,
  "source_ticket_number" text
);--> statement-breakpoint
CREATE INDEX "context_facts_scope_ref_idx" ON "context_facts" USING btree ("scope", "ref_key");
