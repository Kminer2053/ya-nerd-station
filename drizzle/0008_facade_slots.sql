CREATE TABLE `facade_slots` (
 `id` text PRIMARY KEY NOT NULL,
 `alias` text NOT NULL UNIQUE,
 `station_key` text NOT NULL,
 `report_id` text NOT NULL,
 `actor` text NOT NULL,
 `report_version` text NOT NULL,
 `status` text NOT NULL,
 `geometry` text NOT NULL,
 `source_photo_ids` text NOT NULL,
 `evidence` text NOT NULL,
 `uncertainty` text NOT NULL,
 `created_at` text NOT NULL,
 `decided_at` text,
 `proposal_id` text
);
--> statement-breakpoint
CREATE INDEX `facade_slots_station_status` ON `facade_slots` (`station_key`,`status`);
--> statement-breakpoint
CREATE INDEX `facade_slots_report_actor` ON `facade_slots` (`report_id`,`actor`,`report_version`);
