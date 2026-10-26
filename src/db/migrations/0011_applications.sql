CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`character_name` text NOT NULL,
	`server_id` integer NOT NULL,
	`class_name` text NOT NULL,
	`level` integer NOT NULL,
	`legion` text DEFAULT '' NOT NULL,
	`combat_power` integer,
	`item_level` integer,
	`reason` text NOT NULL,
	`schedule` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message_id` text,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
