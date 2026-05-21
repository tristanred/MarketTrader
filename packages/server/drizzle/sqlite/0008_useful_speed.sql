CREATE TABLE `portfolio_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_player_id` text NOT NULL,
	`captured_at` text DEFAULT (datetime('now')) NOT NULL,
	`total_value` real NOT NULL,
	`rank` integer NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_player_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portfolio_snapshots_game_time_idx` ON `portfolio_snapshots` (`game_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `portfolio_snapshots_player_time_idx` ON `portfolio_snapshots` (`game_player_id`,`captured_at`);--> statement-breakpoint
ALTER TABLE `games` ADD `snapshots_compacted_at` text;