CREATE TABLE `restrictions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`origin` text NOT NULL,
	`reason` text,
	`by` text NOT NULL,
	`at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text,
	`character_name` text,
	`server_id` integer,
	`class_name` text,
	`level` integer,
	`legion` text DEFAULT '' NOT NULL,
	`combat_power` integer,
	`item_level` integer,
	`kind` text DEFAULT 'member' NOT NULL,
	`requested_kind` text DEFAULT 'member' NOT NULL,
	`origin` text DEFAULT 'form' NOT NULL,
	`alliance_legion` text,
	`note` text,
	`duplicate_of` text,
	`previous_standing` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`message_id` text,
	`thread_id` text,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_applications`("id", "user_id", "character_id", "character_name", "server_id", "class_name", "level", "legion", "combat_power", "item_level", "status", "message_id", "thread_id", "decided_by", "decided_at", "created_at") SELECT "id", "user_id", "character_id", "character_name", "server_id", "class_name", "level", "legion", "combat_power", "item_level", "status", "message_id", "thread_id", "decided_by", "decided_at", "created_at" FROM `applications`;--> statement-breakpoint
DROP TABLE `applications`;--> statement-breakpoint
ALTER TABLE `__new_applications` RENAME TO `applications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;