CREATE TYPE "public"."trade_status" AS ENUM('pending', 'executed', 'cancelled');--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "executed_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "trades" ALTER COLUMN "executed_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "status" "trade_status" DEFAULT 'executed' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "reserved_price" numeric(15, 4);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "reserved_cash" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "placed_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
-- Backfill: legacy trades were all executed; align placed_at with executed_at.
UPDATE "trades" SET "placed_at" = "executed_at" WHERE "executed_at" IS NOT NULL;