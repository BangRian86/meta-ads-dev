CREATE TYPE "public"."pending_action_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'executed', 'failed');--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"status" "pending_action_status" DEFAULT 'pending' NOT NULL,
	"action_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"executed_result" jsonb,
	"error_message" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_actions_status_idx" ON "pending_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pending_actions_expires_idx" ON "pending_actions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pending_actions_created_idx" ON "pending_actions" USING btree ("created_at");