CREATE TABLE IF NOT EXISTS "achievement_progress" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"game_player_id" text NOT NULL,
	"achievement_key" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"target" integer NOT NULL,
	"unlocked_at" timestamp,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_achievement_progress_player_key" UNIQUE("game_player_id","achievement_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_achievement_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"achievement_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_game_achievement_override" UNIQUE("game_id","achievement_key")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "achievements_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "achievement_progress" ADD CONSTRAINT "achievement_progress_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_achievement_overrides" ADD CONSTRAINT "game_achievement_overrides_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "achievement_progress_game_idx" ON "achievement_progress" USING btree ("game_id");