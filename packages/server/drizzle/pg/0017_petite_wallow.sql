CREATE TYPE "public"."game_visibility" AS ENUM('public', 'private');--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "visibility" "game_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "invite_code" text;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_invite_code_unique" UNIQUE("invite_code");