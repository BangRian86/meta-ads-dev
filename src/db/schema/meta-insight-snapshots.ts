import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  date,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { metaConnections } from './meta-connections.js';

export const insightTargetTypeEnum = pgEnum('insight_target_type', [
  'campaign',
  'adset',
  'ad',
]);

export const metaInsightSnapshots = pgTable(
  'meta_insight_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    targetType: insightTargetTypeEnum('target_type').notNull(),
    targetId: text('target_id').notNull(),
    dateStart: date('date_start').notNull(),
    dateStop: date('date_stop').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    summary: jsonb('summary').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('meta_insight_snapshots_target_idx').on(
      t.targetType,
      t.targetId,
      t.dateStart,
      t.dateStop,
    ),
    index('meta_insight_snapshots_connection_idx').on(t.connectionId),
    index('meta_insight_snapshots_fetched_idx').on(t.fetchedAt),
  ],
);

export type MetaInsightSnapshot = typeof metaInsightSnapshots.$inferSelect;
export type NewMetaInsightSnapshot = typeof metaInsightSnapshots.$inferInsert;
