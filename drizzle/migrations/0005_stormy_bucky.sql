ALTER TABLE "tickets" ADD COLUMN "parent_ticket_id" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "linked_ticket_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "tickets_parent_ticket_id_idx" ON "tickets" USING btree ("parent_ticket_id");