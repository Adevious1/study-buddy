CREATE TABLE IF NOT EXISTS "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"title" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"stars" integer DEFAULT 0 NOT NULL,
	"total_stars" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_subject_kind_check" CHECK ("assignments"."subject_kind" IN ('math','reading','science','writing','spanish','social'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "children" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guardian_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_date" date NOT NULL,
	"grade" integer NOT NULL,
	"pip_color" text NOT NULL,
	"started_with_pip_on" date NOT NULL,
	"streak_days" integer DEFAULT 0 NOT NULL,
	"stars_today" integer DEFAULT 0 NOT NULL,
	"stars_today_max" integer DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "children_pip_color_check" CHECK ("children"."pip_color" IN ('coral','mint','lavender','sun','sky'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guardians_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_profile_traits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"trait_id" text NOT NULL,
	"label" text NOT NULL,
	"score" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lpt_trait_id_check" CHECK ("learning_profile_traits"."trait_id" IN ('visual','narrative','kinesthetic','auditory')),
	CONSTRAINT "lpt_score_range_check" CHECK ("learning_profile_traits"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "learning_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_profiles_child_id_unique" UNIQUE("child_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"active_subjects" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_child_id_unique" UNIQUE("child_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"last_question_index" integer,
	"total_questions" integer,
	"stars_earned" integer,
	"stars_max" integer,
	"solved_self" integer,
	"solved_total" integer,
	"figured_out" jsonb,
	"insight_title" text,
	"insight_body" text,
	"insight_badge" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_subject_kind_check" CHECK ("sessions"."subject_kind" IN ('math','reading','science','writing','spanish','social')),
	CONSTRAINT "sessions_state_check" CHECK ("sessions"."state" IN ('in_progress','completed','abandoned'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "children" ADD CONSTRAINT "children_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_profile_traits" ADD CONSTRAINT "learning_profile_traits_profile_id_learning_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."learning_profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "learning_profiles" ADD CONSTRAINT "learning_profiles_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plans" ADD CONSTRAINT "plans_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_child_date_idx" ON "assignments" USING btree ("child_id","scheduled_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lpt_profile_trait_unique" ON "learning_profile_traits" USING btree ("profile_id","trait_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_child_state_idx" ON "sessions" USING btree ("child_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_child_ended_desc_idx" ON "sessions" USING btree ("child_id","ended_at" DESC NULLS LAST);