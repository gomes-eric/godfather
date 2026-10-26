CREATE TABLE `parties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text,
	`owner_id` text NOT NULL,
	`activity` text NOT NULL,
	`slots` integer NOT NULL,
	`starts_at` text,
	`closed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `party_members` (
	`party_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`party_id`, `user_id`),
	FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE cascade
);
