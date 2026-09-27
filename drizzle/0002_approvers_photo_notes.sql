CREATE TABLE `approver_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `report_photos` ADD `caption` text;--> statement-breakpoint
ALTER TABLE `report_photos` ADD `mark` text;--> statement-breakpoint
ALTER TABLE `report_photos` ADD `preview_size` integer;--> statement-breakpoint
CREATE INDEX `audit_log_action_target` ON `audit_log` (`action`,`target`,`created_at`);