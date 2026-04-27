import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  date,
  index,
} from 'drizzle-orm/pg-core';
import { metaConnections } from './meta-connections.js';

/**
 * Manual closing input for ROAS tracking. Logged via /closing in Telegram by
 * approvers (Bang Rian / Naila). Revenue stored in IDR minor units (sen) so
 * arithmetic against ad spend (also IDR minor) stays integer-precise.
 */
export const closingRecords = pgTable(
  'closing_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK to the Meta connection — anchors closing to a specific account. */
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    /** Snapshot of the connection's ad_account_id at insert time, for fast
     *  joins / per-account aggregation without a connection JOIN. */
    adAccountId: text('ad_account_id').notNull(),
    closingDate: date('closing_date').notNull(),
    /** Number of jamaah / ekor closing — domain-meaningful unit varies per
     *  business (jamaah for Basmalah, ekor for Aqiqah). */
    quantity: integer('quantity').notNull(),
    /** Revenue in IDR minor units (sen). bigint because top-line revenue can
     *  exceed JS safe-int when summed across an account-month. */
    revenueMinor: bigint('revenue_minor', { mode: 'bigint' }).notNull(),
    notes: text('notes'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('closing_records_connection_idx').on(t.connectionId),
    index('closing_records_ad_account_idx').on(t.adAccountId),
    index('closing_records_date_idx').on(t.closingDate),
  ],
);

export type ClosingRecord = typeof closingRecords.$inferSelect;
export type NewClosingRecord = typeof closingRecords.$inferInsert;
