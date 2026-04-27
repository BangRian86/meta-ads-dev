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

export const metaObjectTypeEnum = pgEnum('meta_object_type', [
  'campaign',
  'adset',
  'ad',
]);

export const metaObjectSnapshots = pgTable(
  'meta_object_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    objectType: metaObjectTypeEnum('object_type').notNull(),
    objectId: text('object_id').notNull(),
    /** Direct parent id: campaign_id for adset, adset_id for ad, null for campaign. */
    parentId: text('parent_id'),
    /** Top-level campaign id (denormalized for hierarchy queries). */
    campaignId: text('campaign_id'),
    adAccountId: text('ad_account_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    effectiveStatus: text('effective_status').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('meta_object_snapshots_object_idx').on(t.objectType, t.objectId),
    index('meta_object_snapshots_parent_idx').on(t.parentId),
    index('meta_object_snapshots_campaign_idx').on(t.campaignId),
    index('meta_object_snapshots_connection_idx').on(t.connectionId),
    index('meta_object_snapshots_fetched_idx').on(t.fetchedAt),
  ],
);

export type MetaObjectSnapshot = typeof metaObjectSnapshots.$inferSelect;
export type NewMetaObjectSnapshot = typeof metaObjectSnapshots.$inferInsert;
