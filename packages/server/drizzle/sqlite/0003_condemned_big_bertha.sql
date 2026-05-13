CREATE TABLE `watchlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`watchlist_id` text NOT NULL,
	`symbol` text NOT NULL,
	`added_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`watchlist_id`) REFERENCES `watchlists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_items_watchlist_id_symbol_unique` ON `watchlist_items` (`watchlist_id`,`symbol`);--> statement-breakpoint
CREATE TABLE `watchlists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlists_user_id_name_unique` ON `watchlists` (`user_id`,`name`);--> statement-breakpoint
ALTER TABLE `stock_price_cache` ADD `volume` integer;