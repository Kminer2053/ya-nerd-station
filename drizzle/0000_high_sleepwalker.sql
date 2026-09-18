CREATE TABLE `editor_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `editor_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_hash` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`shared` integer DEFAULT 0 NOT NULL,
	`body` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `editor_projects_owner` ON `editor_projects` (`owner_hash`);