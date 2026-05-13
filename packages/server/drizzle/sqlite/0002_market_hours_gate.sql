PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`game_player_id` text NOT NULL,
	`symbol` text NOT NULL,
	`direction` text NOT NULL,
	`quantity` integer NOT NULL,
	`status` text DEFAULT 'executed' NOT NULL,
	`reserved_price` real,
	`reserved_cash` real,
	`price` real,
	`placed_at` text DEFAULT (datetime('now')) NOT NULL,
	`executed_at` text,
	`cancelled_at` text,
	FOREIGN KEY (`game_player_id`) REFERENCES `game_players`(`id`) ON UPDATE no action ON DELETE restrict
);--> statement-breakpoint
INSERT INTO `__new_trades` (
	`id`, `game_player_id`, `symbol`, `direction`, `quantity`,
	`status`, `reserved_price`, `reserved_cash`, `price`,
	`placed_at`, `executed_at`, `cancelled_at`
)
SELECT
	`id`, `game_player_id`, `symbol`, `direction`, `quantity`,
	'executed', NULL, NULL, `price`,
	`executed_at`, `executed_at`, NULL
FROM `trades`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
ALTER TABLE `__new_trades` RENAME TO `trades`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
