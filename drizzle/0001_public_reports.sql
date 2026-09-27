CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`detail` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`station_key` text NOT NULL,
	`report_ids` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`meta` text,
	`mime` text,
	`size` integer,
	`confidence` real,
	`status` text NOT NULL,
	`reviewer` text,
	`reason` text,
	`created_at` text NOT NULL,
	`decided_at` text
);
--> statement-breakpoint
CREATE INDEX `proposals_station_status` ON `proposals` (`station_key`,`status`);--> statement-breakpoint
CREATE TABLE `report_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `report_photos_report` ON `report_photos` (`report_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`station_key` text NOT NULL,
	`floor` text,
	`position` text,
	`view` text,
	`type` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`place_note` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`reporter_hash` text NOT NULL,
	`user_id` text,
	`group_id` text,
	`analysis` text,
	`history` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reports_station_status` ON `reports` (`station_key`,`status`);--> statement-breakpoint
CREATE INDEX `reports_reporter` ON `reports` (`reporter_hash`);--> statement-breakpoint
CREATE INDEX `reports_group` ON `reports` (`group_id`);--> statement-breakpoint
CREATE TABLE `station_layers` (
	`station_key` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL,
	`updated_at` text NOT NULL
);
