CREATE TABLE "closing_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"ad_account_id" text NOT NULL,
	"closing_date" date NOT NULL,
	"quantity" integer NOT NULL,
	"revenue_minor" bigint NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_dedupe" (
	"alert_key" text PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "closing_records" ADD CONSTRAINT "closing_records_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "closing_records_connection_idx" ON "closing_records" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "closing_records_ad_account_idx" ON "closing_records" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "closing_records_date_idx" ON "closing_records" USING btree ("closing_date");