CREATE TABLE "inbound_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"thread_key" text NOT NULL,
	"from_name" text,
	"from_email" text NOT NULL,
	"to_email" text,
	"subject" text DEFAULT '(no subject)' NOT NULL,
	"body_text" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"ticket_id" integer,
	"triage_note" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_message_id_key" ON "inbound_emails" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_thread_idx" ON "inbound_emails" USING btree ("thread_key");--> statement-breakpoint
CREATE INDEX "inbound_emails_ticket_id_idx" ON "inbound_emails" USING btree ("ticket_id");
