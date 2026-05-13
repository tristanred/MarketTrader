CREATE TABLE IF NOT EXISTS "watchlist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"watchlist_id" text NOT NULL,
	"symbol" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_items_watchlist_id_symbol_unique" UNIQUE("watchlist_id","symbol")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "watchlists" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "watchlists_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "stock_price_cache" ADD COLUMN "volume" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_watchlists_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
