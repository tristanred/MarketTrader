ALTER TABLE `game_player_stats` ADD `trades_utc_date` text;--> statement-breakpoint
ALTER TABLE `game_player_stats` ADD `trades_today` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_player_stats` ADD `losing_sells_today` integer DEFAULT 0 NOT NULL;