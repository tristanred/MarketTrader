CREATE TABLE "discover_market_movers" (
	"id" text PRIMARY KEY NOT NULL,
	"session_date" text NOT NULL,
	"kind" text NOT NULL,
	"items" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discover_market_movers_session_date_kind_unique" UNIQUE("session_date","kind")
);
--> statement-breakpoint
CREATE TABLE "game_discover_picks" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"session_date" text NOT NULL,
	"items" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_discover_picks_game_id_session_date_unique" UNIQUE("game_id","session_date")
);
--> statement-breakpoint
ALTER TABLE "game_discover_picks" ADD CONSTRAINT "game_discover_picks_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;