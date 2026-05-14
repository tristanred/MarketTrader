ALTER TABLE `games` ADD `allow_limit_orders` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `allow_stop_orders` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `allow_bracket_orders` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `allow_gtc` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `order_type` text DEFAULT 'market' NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `time_in_force` text DEFAULT 'day' NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `limit_price` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `stop_price` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `stop_triggered_at` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `parent_trade_id` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `bracket_role` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `take_profit_price` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `stop_loss_price` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `cancel_reason` text;