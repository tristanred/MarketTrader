CREATE TABLE `api_usage_hourly` (
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`route` text NOT NULL,
	`hour_start` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`subject_type`, `subject_id`, `route`, `hour_start`)
);
--> statement-breakpoint
CREATE INDEX `api_usage_hourly_hour_idx` ON `api_usage_hourly` (`hour_start`);--> statement-breakpoint
CREATE TABLE `limit_denials_hourly` (
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`limit_key` text NOT NULL,
	`hour_start` text NOT NULL,
	`count` integer NOT NULL,
	`first_at` text NOT NULL,
	`last_at` text NOT NULL,
	PRIMARY KEY(`subject_type`, `subject_id`, `limit_key`, `hour_start`)
);
--> statement-breakpoint
CREATE INDEX `limit_denials_hourly_hour_idx` ON `limit_denials_hourly` (`hour_start`);