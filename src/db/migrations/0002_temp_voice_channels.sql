CREATE TABLE `temp_voice_channels` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`generator_key` text NOT NULL,
	`number` integer NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `temp_voice_generator_idx` ON `temp_voice_channels` (`generator_key`);