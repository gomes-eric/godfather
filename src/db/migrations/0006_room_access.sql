ALTER TABLE `temp_voice_channels` ADD `locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `temp_voice_channels` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `temp_voice_channels` ADD `panel_message_id` text;