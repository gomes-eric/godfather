ALTER TABLE `posted_patch_notes` RENAME TO `posted_news`;--> statement-breakpoint
-- The #patch-notes channel became #noticias under the key "news": keep the same Discord channel.
UPDATE `managed_objects` SET `key` = 'news' WHERE `kind` = 'channel' AND `key` = 'patch-notes';
