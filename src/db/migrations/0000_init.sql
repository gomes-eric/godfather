CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`actor_id` text NOT NULL,
	`actor_tier` text NOT NULL,
	`source` text NOT NULL,
	`harness` text,
	`action` text NOT NULL,
	`target` text,
	`params_json` text,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);