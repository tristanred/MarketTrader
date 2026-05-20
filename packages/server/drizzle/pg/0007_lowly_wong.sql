CREATE TABLE IF NOT EXISTS "portfolio_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"game_player_id" text NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"total_value" numeric(15, 2) NOT NULL,
	"rank" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "snapshots_compacted_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_snapshots_game_time_idx" ON "portfolio_snapshots" USING btree ("game_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_snapshots_player_time_idx" ON "portfolio_snapshots" USING btree ("game_player_id","captured_at");