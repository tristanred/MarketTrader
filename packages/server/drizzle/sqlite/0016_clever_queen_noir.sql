CREATE INDEX `trades_status_idx` ON `trades` (`status`);--> statement-breakpoint
CREATE INDEX `trades_player_status_idx` ON `trades` (`game_player_id`,`status`);