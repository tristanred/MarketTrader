CREATE TABLE `discover_market_movers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_date` text NOT NULL,
	`kind` text NOT NULL,
	`items` text NOT NULL,
	`fetched_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discover_market_movers_session_date_kind_unique` ON `discover_market_movers` (`session_date`,`kind`);--> statement-breakpoint
CREATE TABLE `game_discover_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`session_date` text NOT NULL,
	`items` text NOT NULL,
	`generated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_discover_picks_game_id_session_date_unique` ON `game_discover_picks` (`game_id`,`session_date`);