CREATE TABLE `managed_objects` (
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`discord_id` text NOT NULL,
	`fingerprint` text,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`kind`, `key`)
);
