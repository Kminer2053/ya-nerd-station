CREATE TABLE batch_runs (id text PRIMARY KEY NOT NULL,actor text NOT NULL,source text NOT NULL,station_key text,notes text NOT NULL,request_key text NOT NULL,created_at text NOT NULL,updated_at text NOT NULL);
--> statement-breakpoint
CREATE INDEX batch_runs_actor ON batch_runs(actor,created_at);
--> statement-breakpoint
CREATE TABLE batch_items (id text PRIMARY KEY NOT NULL,run_id text NOT NULL,report_id text NOT NULL,report_version text NOT NULL,status text NOT NULL DEFAULT 'pending',job_id text,error text,updated_at text NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX batch_items_report ON batch_items(run_id,report_id);
--> statement-breakpoint
CREATE INDEX batch_items_status ON batch_items(status,run_id);
--> statement-breakpoint
CREATE TABLE batch_schedules (actor text PRIMARY KEY NOT NULL,enabled integer NOT NULL DEFAULT 0,interval_minutes integer NOT NULL DEFAULT 60,station_key text,notes text NOT NULL DEFAULT '',next_run_at text NOT NULL,updated_at text NOT NULL);
