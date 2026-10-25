CREATE TABLE `field_boss_source_health` (
	`provider` text PRIMARY KEY NOT NULL,
	`last_ok_at` integer,
	`last_error_at` integer,
	`last_error` text,
	`last_warned_at` integer
);
--> statement-breakpoint
CREATE TABLE `field_boss_timers` (
	`boss_key` text PRIMARY KEY NOT NULL,
	`alive` integer NOT NULL,
	`respawn_at` integer,
	`seen_at` integer NOT NULL,
	`source` text NOT NULL,
	`override_by` text,
	`updated_at` integer NOT NULL
);
