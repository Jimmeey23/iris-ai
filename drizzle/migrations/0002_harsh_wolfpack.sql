CREATE TABLE "trainer_analysis" (
	"trainer_id" integer PRIMARY KEY NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"narrative" text DEFAULT '' NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priorities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coaching_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trajectory" text DEFAULT '' NOT NULL,
	"risk" text DEFAULT 'stable' NOT NULL,
	"engine" text DEFAULT '' NOT NULL,
	"eval_count" integer DEFAULT 0 NOT NULL,
	"latest_eval_id" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
