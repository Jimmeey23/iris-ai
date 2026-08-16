CREATE TABLE "custom_fillout_forms" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"blurb" text DEFAULT '' NOT NULL,
	"template" text DEFAULT 'General' NOT NULL,
	"embed_id" text NOT NULL,
	"embed_kind" text DEFAULT 'fillout-v1' NOT NULL,
	"height" integer DEFAULT 500 NOT NULL,
	"icon" text DEFAULT '▤' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_fillout_forms_slug_unique" UNIQUE("slug")
);
