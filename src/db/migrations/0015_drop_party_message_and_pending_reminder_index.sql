DROP INDEX `reminder_due_idx`;--> statement-breakpoint
CREATE INDEX `reminder_pending_due_idx` ON `reminders` (`due_at`) WHERE "reminders"."sent_at" IS NULL AND "reminders"."skipped_at" IS NULL;--> statement-breakpoint
ALTER TABLE `parties` DROP COLUMN `message_id`;