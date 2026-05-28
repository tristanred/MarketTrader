CREATE TABLE IF NOT EXISTS "position_high_water" (
	"game_player_id" text NOT NULL,
	"symbol" text NOT NULL,
	"opened_at" timestamp NOT NULL,
	"peak_value" real NOT NULL,
	"peak_pnl_pct" real NOT NULL,
	"trough_pnl_pct" real NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "position_high_water_game_player_id_symbol_pk" PRIMARY KEY("game_player_id","symbol")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "position_high_water" ADD CONSTRAINT "position_high_water_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
