CREATE TYPE "public"."game_status" AS ENUM('pending', 'active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."trade_direction" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_players" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"user_id" text NOT NULL,
	"cash_balance" numeric(15, 2) NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_players_game_id_user_id_unique" UNIQUE("game_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "games" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"starting_balance" numeric(15, 2) DEFAULT '100000' NOT NULL,
	"status" "game_status" DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolios" (
	"id" text PRIMARY KEY NOT NULL,
	"game_player_id" text NOT NULL,
	"symbol" text NOT NULL,
	"quantity" integer NOT NULL,
	"avg_cost_basis" numeric(15, 2) NOT NULL,
	CONSTRAINT "portfolios_game_player_id_symbol_unique" UNIQUE("game_player_id","symbol")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_price_cache" (
	"symbol" text PRIMARY KEY NOT NULL,
	"price" numeric(15, 4) NOT NULL,
	"change" numeric(15, 4) NOT NULL,
	"change_percent" numeric(10, 4) NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"game_player_id" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" "trade_direction" NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(15, 4) NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_players" ADD CONSTRAINT "game_players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_game_player_id_game_players_id_fk" FOREIGN KEY ("game_player_id") REFERENCES "public"."game_players"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
