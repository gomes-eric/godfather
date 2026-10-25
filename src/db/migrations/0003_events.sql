CREATE TABLE `event_occurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_key` text,
	`event_id` integer,
	`starts_at` integer NOT NULL,
	`cancelled_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_template_start_idx` ON `event_occurrences` (`template_key`,`starts_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_event_idx` ON `event_occurrences` (`event_id`);--> statement-breakpoint
CREATE INDEX `occurrence_start_idx` ON `event_occurrences` (`starts_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`emoji` text NOT NULL,
	`description` text,
	`starts_at` integer NOT NULL,
	`voice_channel_id` text,
	`ping` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurrence_id` integer NOT NULL,
	`offset_minutes` integer NOT NULL,
	`due_at` integer NOT NULL,
	`sent_at` integer,
	`skipped_at` integer,
	`message_id` text,
	FOREIGN KEY (`occurrence_id`) REFERENCES `event_occurrences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_occurrence_offset_idx` ON `reminders` (`occurrence_id`,`offset_minutes`);--> statement-breakpoint
CREATE INDEX `reminder_due_idx` ON `reminders` (`due_at`);--> statement-breakpoint
CREATE TABLE `rsvps` (
	`occurrence_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`occurrence_id`, `user_id`),
	FOREIGN KEY (`occurrence_id`) REFERENCES `event_occurrences`(`id`) ON UPDATE no action ON DELETE cascade
);
