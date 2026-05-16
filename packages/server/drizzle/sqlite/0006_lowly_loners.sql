CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`before` text,
	`after` text,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`admin_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);--> statement-breakpoint
CREATE TABLE `user_groups` (
	`user_id` text NOT NULL,
	`group_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `group_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game_players` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`user_id` text NOT NULL,
	`cash_balance` real NOT NULL,
	`joined_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_game_players`("id", "game_id", "user_id", "cash_balance", "joined_at") SELECT "id", "game_id", "user_id", "cash_balance", "joined_at" FROM `game_players`;--> statement-breakpoint
DROP TABLE `game_players`;--> statement-breakpoint
ALTER TABLE `__new_game_players` RENAME TO `game_players`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `game_players_game_id_user_id_unique` ON `game_players` (`game_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `__new_portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`game_player_id` text NOT NULL,
	`symbol` text NOT NULL,
	`quantity` integer NOT NULL,
	`avg_cost_basis` real NOT NULL,
	FOREIGN KEY (`game_player_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade
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
	`status` text DEFAULT 'executed' NOT NULL,
	`order_type` text DEFAULT 'market' NOT NULL,
	`time_in_force` text DEFAULT 'day' NOT NULL,
	`limit_price` real,
	`stop_price` real,
	`stop_triggered_at` text,
	`parent_trade_id` text,
	`bracket_role` text,
	`take_profit_price` real,
	`stop_loss_price` real,
	`expires_at` text,
	`reserved_price` real,
	`reserved_cash` real,
	`price` real,
	`placed_at` text DEFAULT (datetime('now')) NOT NULL,
	`executed_at` text,
	`cancelled_at` text,
	`cancel_reason` text,
	FOREIGN KEY (`game_player_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_trades`("id", "game_player_id", "symbol", "direction", "quantity", "status", "order_type", "time_in_force", "limit_price", "stop_price", "stop_triggered_at", "parent_trade_id", "bracket_role", "take_profit_price", "stop_loss_price", "expires_at", "reserved_price", "reserved_cash", "price", "placed_at", "executed_at", "cancelled_at", "cancel_reason") SELECT "id", "game_player_id", "symbol", "direction", "quantity", "status", "order_type", "time_in_force", "limit_price", "stop_price", "stop_triggered_at", "parent_trade_id", "bracket_role", "take_profit_price", "stop_loss_price", "expires_at", "reserved_price", "reserved_cash", "price", "placed_at", "executed_at", "cancelled_at", "cancel_reason" FROM `trades`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
ALTER TABLE `__new_trades` RENAME TO `trades`;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
INSERT INTO `groups` (`id`, `name`) VALUES ('00000000-0000-0000-0000-000000000001', 'admin');