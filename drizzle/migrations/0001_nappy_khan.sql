CREATE TABLE "whatsapp_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"language_code" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"channel_id" integer NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_templates_template_id_unique" UNIQUE("template_id")
);
