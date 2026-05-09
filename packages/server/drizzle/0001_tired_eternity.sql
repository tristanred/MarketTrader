PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game_players` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`cash_balance` real NOT NULL,
	`joined_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_game_players`("id", "game_id", "user_id", "cash_balance", "joined_at") SELECT "id", "game_id", "user_id", "cash_balance", "joined_at" FROM `game_players`;--> statement-breakpoint
DROP TABLE `game_players`;--> statement-breakpoint
ALTER TABLE `__new_game_players` RENAME TO `game_players`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `game_players_game_id_user_id_unique` ON `game_players` (`game_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`starting_balance` real DEFAULT 100000 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_games`("id", "name", "start_date", "end_date", "starting_balance", "status", "created_by", "created_at") SELECT "id", "name", "start_date", "end_date", "starting_balance", "status", "created_by", "created_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
CREATE TABLE `__new_portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`game_player_id` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` integer NOT NULL,
	`avg_cost_basis` real NOT NULL,
	FOREIGN KEY (`game_player_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_portfolios`("id", "game_player_id", "symbol", "quantity", "avg_cost_basis") SELECT "id", "game_player_id", "symbol", "quantity", "avg_cost_basis" FROM `portfolios`;--> statement-breakpoint
DROP TABLE `portfolios`;--> statement-breakpoint
ALTER TABLE `__new_portfolios` RENAME TO `portfolios`;--> statement-breakpoint
CREATE UNIQUE INDEX `portfolios_game_player_id_symbol_unique` ON `portfolios` (`game_player_id`,`symbol`);--> statement-breakpoint
CREATE TABLE `__new_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`game_player_id` text NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`quantity` integer NOT NULL,
	`price` real NOT NULL,
	`executed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_player_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_trades`("id", "game_player_id", "symbol", "direction", "quantity", "price", "executed_at") SELECT "id", "game_player_id", "symbol", "direction", "quantity", "price", "executed_at" FROM `trades`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
ALTER TABLE `__new_trades` RENAME TO `trades`;--> statement-breakpoint
CREATE TABLE `__new_stock_price_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`price` real NOT NULL,
	`change` real NOT NULL,
	`change_percent` real NOT NULL,
	`fetched_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_stock_price_cache`("symbol", "price", "change", "change_percent", "fetched_at") SELECT "symbol", "price", "change", "change_percent", "fetched_at" FROM `stock_price_cache`;--> statement-breakpoint
DROP TABLE `stock_price_cache`;--> statement-breakpoint
ALTER TABLE `__new_stock_price_cache` RENAME TO `stock_price_cache`;