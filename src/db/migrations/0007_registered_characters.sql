CREATE TABLE `registered_characters` (
	`user_id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`name` text NOT NULL,
	`server_id` integer NOT NULL,
	`class_key` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
