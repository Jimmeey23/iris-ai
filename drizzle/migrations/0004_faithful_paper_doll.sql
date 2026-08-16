CREATE TABLE "user_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'executive' NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_accounts_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "user_accounts_email_unique" UNIQUE("email")
);
