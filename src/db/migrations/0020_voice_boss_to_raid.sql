UPDATE `managed_objects` SET `key` = 'raid-rooms' WHERE `kind` = 'category' AND `key` = 'boss-rooms';--> statement-breakpoint
UPDATE `managed_objects` SET `key` = 'gen-raid' WHERE `kind` = 'channel' AND `key` = 'gen-bosses';--> statement-breakpoint
UPDATE `temp_voice_channels` SET `generator_key` = 'gen-raid' WHERE `generator_key` = 'gen-bosses';
