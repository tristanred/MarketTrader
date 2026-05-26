CREATE TABLE IF NOT EXISTS "game_player_stats" (
	"game_player_id" text PRIMARY KEY NOT NULL,
	"peak_portfolio_value" numeric(15, 2),
	"peak_portfolio_at" timestamp,
	"trough_portfolio_value" numeric(15, 2),
	"trough_portfolio_at" timestamp,
	"best_rank" integer,
	"worst_rank" integer,
	"last_rank" integer,
	"days_at_rank_one" integer DEFAULT 0 NOT NULL,
	"consecutive_days_at_rank_one" integer DEFAULT 0 NOT NULL,
	"days_in_top_three" integer DEFAULT 0 NOT NULL,
	"consecutive_days_at_or_above_median" integer DEFAULT 0 NOT NULL,
	"consecutive_days_in_last_place" integer DEFAULT 0 NOT NULL,
	"last_day_counted" text,
	"last_day_rank" integer,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"buy_trades" integer DEFAULT 0 NOT NULL,
	"sell_trades" integer DEFAULT 0 NOT NULL,
	"distinct_symbols_traded_ever" integer DEFAULT 0 NOT NULL,
	"total_volume_traded" numeric(18, 2) DEFAULT '0' NOT NULL,
	"realized_pnl" numeric(15, 2) DEFAULT '0' NOT NULL,
	"winning_closed_positions" integer DEFAULT 0 NOT NULL,
	"losing_closed_positions" integer DEFAULT 0 NOT NULL,
	"consecutive_wins" integer DEFAULT 0 NOT NULL,
	"best_single_pnl" numeric(15, 2),
	"worst_single_pnl" numeric(15, 2),
	"best_single_pnl_pct" numeric(12, 6),
	"worst_single_pnl_pct" numeric(12, 6),
	"shortest_hold_ms" integer,
	"longest_hold_ms" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portfolios" ADD COLUMN "opened_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_player_stats" ADD CONSTRAINT "game_player_stats_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
