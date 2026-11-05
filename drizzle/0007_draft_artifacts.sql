CREATE TABLE `job_artifacts` (
 `id` text PRIMARY KEY NOT NULL,
 `job_id` text NOT NULL,
 `report_id` text NOT NULL,
 `actor` text NOT NULL,
 `report_version` text NOT NULL,
 `sha256` text NOT NULL,
 `mime` text NOT NULL,
 `size` integer NOT NULL,
 `width` integer NOT NULL,
 `height` integer NOT NULL,
 `source_photo_ids` text NOT NULL,
 `provenance` text NOT NULL,
 `storage_key` text NOT NULL,
 `created_at` text NOT NULL
);
CREATE INDEX `job_artifacts_job` ON `job_artifacts` (`job_id`,`actor`);
