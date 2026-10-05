CREATE TABLE `work_files` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`actor` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_files_thread` ON `work_files` (`report_id`,`actor`);--> statement-breakpoint
CREATE TABLE `work_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`actor` text NOT NULL,
	`role` text NOT NULL,
	`job_id` text,
	`text` text NOT NULL,
	`attachment_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_messages_thread` ON `work_messages` (`report_id`,`actor`,`created_at`);