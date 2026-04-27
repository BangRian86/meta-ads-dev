CREATE TYPE "public"."connection_status" AS ENUM('active', 'invalid', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."token_type" AS ENUM('short_lived', 'long_lived', 'system_user');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."insight_target_type" AS ENUM('campaign', 'adset', 'ad');--> statement-breakpoint
CREATE TYPE "public"."rule_draft_state" AS ENUM('draft', 'published', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."rule_draft_status_intent" AS ENUM('enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."meta_object_type" AS ENUM('campaign', 'adset', 'ad');--> statement-breakpoint
CREATE TYPE "public"."kie_credential_status" AS ENUM('active', 'invalid', 'credits_exhausted');--> statement-breakpoint
CREATE TYPE "public"."content_asset_provider" AS ENUM('kie');--> statement-breakpoint
CREATE TYPE "public"."content_asset_status" AS ENUM('pending', 'processing', 'success', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."content_asset_type" AS ENUM('image_generated', 'image_edited');--> statement-breakpoint
CREATE TYPE "public"."copy_variant_status" AS ENUM('draft', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."copy_variant_strategy" AS ENUM('heuristic', 'manual', 'reviewed_existing');--> statement-breakpoint
CREATE TABLE "meta_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_name" text NOT NULL,
	"meta_user_id" text,
	"ad_account_id" text NOT NULL,
	"access_token" text NOT NULL,
	"token_type" "token_type" DEFAULT 'long_lived' NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"invalid_reason" text,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"operation_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"status" "audit_status" NOT NULL,
	"request_body" jsonb,
	"response_body" jsonb,
	"error_code" text,
	"error_message" text,
	"actor_id" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_request_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid,
	"method" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_params" jsonb,
	"response_status" integer,
	"response_body" jsonb,
	"error_code" text,
	"error_subcode" text,
	"error_kind" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_insight_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"target_type" "insight_target_type" NOT NULL,
	"target_id" text NOT NULL,
	"date_start" date NOT NULL,
	"date_stop" date NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_rule_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"account_id" text NOT NULL,
	"evaluation_spec" jsonb NOT NULL,
	"execution_spec" jsonb NOT NULL,
	"schedule_spec" jsonb,
	"raw_payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_rule_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status_intent" "rule_draft_status_intent" DEFAULT 'disabled' NOT NULL,
	"state" "rule_draft_state" DEFAULT 'draft' NOT NULL,
	"evaluation_spec" jsonb NOT NULL,
	"execution_spec" jsonb NOT NULL,
	"schedule_spec" jsonb,
	"notes" text,
	"published_rule_id" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_object_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"object_type" "meta_object_type" NOT NULL,
	"object_id" text NOT NULL,
	"parent_id" text,
	"campaign_id" text,
	"ad_account_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"effective_status" text NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kie_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"api_key" text NOT NULL,
	"status" "kie_credential_status" DEFAULT 'active' NOT NULL,
	"invalid_reason" text,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" "content_asset_provider" NOT NULL,
	"provider_task_id" text NOT NULL,
	"asset_type" "content_asset_type" NOT NULL,
	"status" "content_asset_status" DEFAULT 'pending' NOT NULL,
	"prompt" text,
	"source_urls" jsonb,
	"result_urls" jsonb,
	"request_params" jsonb,
	"metadata" jsonb,
	"error_code" text,
	"error_message" text,
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"title" text NOT NULL,
	"product" text,
	"audience" text,
	"key_benefits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tone" text,
	"forbidden_words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_action" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"brief_id" uuid,
	"version" integer NOT NULL,
	"parent_id" uuid,
	"status" "copy_variant_status" DEFAULT 'draft' NOT NULL,
	"strategy" "copy_variant_strategy" NOT NULL,
	"primary_text" text NOT NULL,
	"headline" text NOT NULL,
	"description" text,
	"cta" text NOT NULL,
	"language" text,
	"review_score" jsonb,
	"review_notes" jsonb,
	"metadata" jsonb,
	"created_by" text,
	"status_changed_by" text,
	"status_changed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operation_audits" ADD CONSTRAINT "operation_audits_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_request_logs" ADD CONSTRAINT "meta_request_logs_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_insight_snapshots" ADD CONSTRAINT "meta_insight_snapshots_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_rule_snapshots" ADD CONSTRAINT "meta_rule_snapshots_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_rule_drafts" ADD CONSTRAINT "meta_rule_drafts_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_object_snapshots" ADD CONSTRAINT "meta_object_snapshots_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_briefs" ADD CONSTRAINT "copy_briefs_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variants" ADD CONSTRAINT "copy_variants_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variants" ADD CONSTRAINT "copy_variants_brief_id_copy_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."copy_briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meta_connections_status_idx" ON "meta_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meta_connections_ad_account_idx" ON "meta_connections" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "operation_audits_connection_idx" ON "operation_audits" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "operation_audits_target_idx" ON "operation_audits" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "operation_audits_created_idx" ON "operation_audits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "operation_audits_status_idx" ON "operation_audits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meta_request_logs_connection_idx" ON "meta_request_logs" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "meta_request_logs_created_idx" ON "meta_request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "meta_request_logs_endpoint_idx" ON "meta_request_logs" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "meta_request_logs_error_idx" ON "meta_request_logs" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "meta_insight_snapshots_target_idx" ON "meta_insight_snapshots" USING btree ("target_type","target_id","date_start","date_stop");--> statement-breakpoint
CREATE INDEX "meta_insight_snapshots_connection_idx" ON "meta_insight_snapshots" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "meta_insight_snapshots_fetched_idx" ON "meta_insight_snapshots" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "meta_rule_snapshots_connection_idx" ON "meta_rule_snapshots" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "meta_rule_snapshots_rule_idx" ON "meta_rule_snapshots" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "meta_rule_snapshots_fetched_idx" ON "meta_rule_snapshots" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "meta_rule_drafts_connection_idx" ON "meta_rule_drafts" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "meta_rule_drafts_state_idx" ON "meta_rule_drafts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "meta_rule_drafts_published_rule_idx" ON "meta_rule_drafts" USING btree ("published_rule_id");--> statement-breakpoint
CREATE INDEX "meta_object_snapshots_object_idx" ON "meta_object_snapshots" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "meta_object_snapshots_parent_idx" ON "meta_object_snapshots" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "meta_object_snapshots_campaign_idx" ON "meta_object_snapshots" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "meta_object_snapshots_connection_idx" ON "meta_object_snapshots" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "meta_object_snapshots_fetched_idx" ON "meta_object_snapshots" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "kie_credentials_status_idx" ON "kie_credentials" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_assets_connection_idx" ON "content_assets" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "content_assets_status_idx" ON "content_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_assets_provider_task_idx" ON "content_assets" USING btree ("provider","provider_task_id");--> statement-breakpoint
CREATE INDEX "content_assets_expires_idx" ON "content_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "copy_briefs_connection_idx" ON "copy_briefs" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "copy_variants_brief_idx" ON "copy_variants" USING btree ("brief_id","version");--> statement-breakpoint
CREATE INDEX "copy_variants_connection_idx" ON "copy_variants" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "copy_variants_status_idx" ON "copy_variants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "copy_variants_parent_idx" ON "copy_variants" USING btree ("parent_id");