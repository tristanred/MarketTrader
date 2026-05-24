CREATE TABLE `achievement_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`game_player_id` text NOT NULL,
	`achievement_key` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`target` integer NOT NULL,
	`unlocked_at` text,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_player_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `achievement_progress_game_idx` ON `achievement_progress` (`game_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_achievement_progress_player_key` ON `achievement_progress` (`game_player_id`,`achievement_key`);--> statement-breakpoint
CREATE TABLE `game_achievement_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`achievement_key` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_game_achievement_override` ON `game_achievement_overrides` (`game_id`,`achievement_key`);--> statement-breakpoint
ALTER TABLE `games` ADD `achievements_enabled` integer DEFAULT true NOT NULL;