CREATE TABLE `agent_runners` (
 `id` text PRIMARY KEY NOT NULL,
 `actor` text NOT NULL,
 `principal_id` text NOT NULL,
 `link_id` text NOT NULL,
 `label` text NOT NULL,
 `report_id` text,
 `phase` text NOT NULL DEFAULT 'idle',
 `error_code` text,
 `created_at` text NOT NULL,
 `last_seen_at` text NOT NULL,
 `revoked_at` text
);
--> statement-breakpoint
CREATE INDEX `agent_runners_actor` ON `agent_runners` (`actor`,`last_seen_at`);
--> statement-breakpoint
CREATE TABLE `agent_runner_leases` (
 `job_id` text PRIMARY KEY NOT NULL,
 `runner_id` text NOT NULL,
 `request_id` text NOT NULL,
 `token_hash` text NOT NULL,
 `status` text NOT NULL,
 `outcome` text,
 `error_code` text,
 `lease_until` text NOT NULL,
 `started_at` text,
 `created_at` text NOT NULL,
 `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runner_request` ON `agent_runner_leases` (`runner_id`,`request_id`);
--> statement-breakpoint
CREATE INDEX `agent_runner_active` ON `agent_runner_leases` (`runner_id`,`status`,`lease_until`);
