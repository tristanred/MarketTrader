CREATE TABLE `position_high_water` (
	`game_player_id` text NOT NULL,
	`symbol` text NOT NULL,
	`opened_at` text NOT NULL,
	`peak_value` real NOT NULL,
	`peak_pnl_pct` real NOT NULL,
	`trough_pnl_pct` real NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`game_player_id`, `symbol`),
	FOREIGN KEY (`game_player_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade
);
