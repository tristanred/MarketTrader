DROP INDEX IF EXISTS "game_players_game_id_user_id_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "portfolios_game_player_id_symbol_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "users_username_unique";--> statement-breakpoint
ALTER TABLE `trades` ALTER COLUMN "price" TO "price" real;--> statement-breakpoint
CREATE UNIQUE INDEX `game_players_game_id_user_id_unique` ON `game_players` (`game_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `portfolios_game_player_id_symbol_unique` ON `portfolios` (`game_player_id`,`symbol`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
ALTER TABLE `trades` ALTER COLUMN "executed_at" TO "executed_at" text;--> statement-breakpoint
ALTER TABLE `trades` ADD `status` text DEFAULT 'executed' NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `reserved_price` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `reserved_cash` real;--> statement-breakpoint
ALTER TABLE `trades` ADD `placed_at` text DEFAULT (datetime('now')) NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `cancelled_at` text;--> statement-breakpoint
-- Backfill: legacy trades were all executed; align placed_at with executed_at.
UPDATE `trades` SET `placed_at` = `executed_at` WHERE `executed_at` IS NOT NULL;