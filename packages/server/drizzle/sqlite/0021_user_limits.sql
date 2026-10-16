CREATE TABLE `user_limit_overrides` (
	`user_id` text NOT NULL,
	`limit_key` text NOT NULL,
	`value` integer NOT NULL,
	`note` text,
	`updated_by` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `limit_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `registration_ip` text;--> statement-breakpoint
CREATE INDEX `users_registration_ip_created_idx` ON `users` (`registration_ip`,`created_at`);--> statement-breakpoint
CREATE INDEX `game_players_user_joined_idx` ON `game_players` (`user_id`,`joined_at`);--> statement-breakpoint
CREATE INDEX `games_created_by_created_at_idx` ON `games` (`created_by`,`created_at`);