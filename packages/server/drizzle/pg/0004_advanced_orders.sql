CREATE TYPE "public"."bracket_role" AS ENUM('entry', 'take_profit', 'stop_loss');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market', 'limit', 'stop', 'stop_limit', 'bracket');--> statement-breakpoint
CREATE TYPE "public"."time_in_force" AS ENUM('day', 'gtc');--> statement-breakpoint
ALTER TYPE "public"."trade_status" ADD VALUE 'working' BEFORE 'executed';--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "allow_limit_orders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "allow_stop_orders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "allow_bracket_orders" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "allow_gtc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "order_type" "order_type" DEFAULT 'market' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "time_in_force" time_in_force DEFAULT 'day' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "limit_price" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "stop_price" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "stop_triggered_at" timestamp;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "parent_trade_id" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "bracket_role" "bracket_role";--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "take_profit_price" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "stop_loss_price" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "cancel_reason" text;