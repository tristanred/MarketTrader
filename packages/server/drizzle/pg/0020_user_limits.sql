CREATE TABLE "user_limit_overrides" (
	"user_id" text NOT NULL,
	"limit_key" text NOT NULL,
	"value" integer NOT NULL,
	"note" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_limit_overrides_user_id_limit_key_pk" PRIMARY KEY("user_id","limit_key")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "registration_ip" text;--> statement-breakpoint
ALTER TABLE "user_limit_overrides" ADD CONSTRAINT "user_limit_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_players_user_joined_idx" ON "game_players" USING btree ("user_id","joined_at");--> statement-breakpoint
CREATE INDEX "games_created_by_created_at_idx" ON "games" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "users_registration_ip_created_idx" ON "users" USING btree ("registration_ip","created_at");