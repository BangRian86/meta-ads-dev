CREATE TYPE "public"."kie_task_status" AS ENUM('queued', 'in_progress', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "kie_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_type" text NOT NULL,
	"status" "kie_task_status" DEFAULT 'queued' NOT NULL,
	"provider" text,
	"input_payload" jsonb NOT NULL,
	"output_payload" jsonb,
	"credits_used" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"cursor_value" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cursors_conn_type_uniq" UNIQUE("connection_id","object_type")
);
--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kie_tasks_status_idx" ON "kie_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kie_tasks_type_idx" ON "kie_tasks" USING btree ("task_type");--> statement-breakpoint
CREATE INDEX "kie_tasks_created_idx" ON "kie_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "kie_tasks_expires_idx" ON "kie_tasks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sync_cursors_synced_idx" ON "sync_cursors" USING btree ("last_synced_at");