CREATE TABLE `agent_links` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`code_hash` text NOT NULL,
	`principal_id` text,
	`label` text NOT NULL,
	`created_at` text NOT NULL,
	`code_expires_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`redeemed_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_links_code_hash_unique` ON `agent_links` (`code_hash`);--> statement-breakpoint
CREATE INDEX `agent_links_principal` ON `agent_links` (`principal_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `agent_links_actor` ON `agent_links` (`actor`,`created_at`);