import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { metaConnections } from './meta-connections.js';

export const contentAssetStatusEnum = pgEnum('content_asset_status', [
  'pending',
  'processing',
  'success',
  'failed',
  'expired',
]);

export const contentAssetTypeEnum = pgEnum('content_asset_type', [
  'image_generated',
  'image_edited',
  'video_generated',
  'video_image_to_video',
]);

export const contentAssetProviderEnum = pgEnum('content_asset_provider', [
  'kie',
]);

export const contentAssets = pgTable(
  'content_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    provider: contentAssetProviderEnum('provider').notNull(),
    /** External provider's task identifier (e.g. KIE taskId). */
    providerTaskId: text('provider_task_id').notNull(),
    assetType: contentAssetTypeEnum('asset_type').notNull(),
    status: contentAssetStatusEnum('status').notNull().default('pending'),
    prompt: text('prompt'),
    /** URLs of source images (for edits / references). */
    sourceUrls: jsonb('source_urls'),
    /** URLs of resulting images (populated on success). */
    resultUrls: jsonb('result_urls'),
    requestParams: jsonb('request_params'),
    metadata: jsonb('metadata'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    /** Provider-hosted asset URLs commonly expire — record best-known TTL. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('content_assets_connection_idx').on(t.connectionId),
    index('content_assets_status_idx').on(t.status),
    index('content_assets_provider_task_idx').on(t.provider, t.providerTaskId),
    index('content_assets_expires_idx').on(t.expiresAt),
  ],
);

export type ContentAsset = typeof contentAssets.$inferSelect;
export type NewContentAsset = typeof contentAssets.$inferInsert;
