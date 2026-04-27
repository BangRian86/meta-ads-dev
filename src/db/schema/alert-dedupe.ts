import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Single-row-per-alert-key store for anomaly alert deduplication.
 * `alertKey` encodes (connectionId, anomaly kind, target) so the same alert
 * can't spam the group within the cooldown window. Upsert on key, compare
 * `lastSentAt` to "now - 6h" to decide whether to send.
 */
export const alertDedupe = pgTable('alert_dedupe', {
  alertKey: text('alert_key').primaryKey(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AlertDedupeRow = typeof alertDedupe.$inferSelect;
export type NewAlertDedupeRow = typeof alertDedupe.$inferInsert;
