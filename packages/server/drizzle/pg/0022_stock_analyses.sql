CREATE TABLE "stock_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"model" text NOT NULL,
	"reported_model" text,
	"prompt_version" integer NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"generated_by" text,
	"result" text,
	"price_at_analysis" real NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_analyses" ADD CONSTRAINT "stock_analyses_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_analyses_cache_idx" ON "stock_analyses" USING btree ("symbol","prompt_version","model","created_at");--> statement-breakpoint
CREATE INDEX "stock_analyses_user_idx" ON "stock_analyses" USING btree ("generated_by","created_at");--> statement-breakpoint
CREATE INDEX "stock_analyses_created_idx" ON "stock_analyses" USING btree ("created_at");