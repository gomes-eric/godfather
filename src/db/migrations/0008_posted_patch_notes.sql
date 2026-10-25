CREATE TABLE `posted_patch_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`posted_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
