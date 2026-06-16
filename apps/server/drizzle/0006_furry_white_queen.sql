ALTER TABLE "sessions" ADD COLUMN "recap_source" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reconnect_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_recap_source_check" CHECK ("sessions"."recap_source" IN ('model','fallback'));