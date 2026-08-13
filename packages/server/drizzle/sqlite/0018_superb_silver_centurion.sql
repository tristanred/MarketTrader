ALTER TABLE `games` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `invite_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `games_invite_code_unique` ON `games` (`invite_code`);