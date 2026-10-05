CREATE TABLE `report_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`station_key` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`report_version` text NOT NULL,
	`actor` text NOT NULL,
	`input` text NOT NULL,
	`plan` text,
	`questions` text DEFAULT '[]' NOT NULL,
	`error` text,
	`proposal_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `report_jobs_report` ON `report_jobs` (`report_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `report_jobs_status` ON `report_jobs` (`status`,`updated_at`);