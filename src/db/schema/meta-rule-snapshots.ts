import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { metaConnections } from './meta-connections.js';

export const metaRuleSnapshots = pgTable(
  'meta_rule_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    /** Meta's adrules_library object id (string). */
    ruleId: text('rule_id').notNull(),
    name: text('name').notNull(),
    /** Meta status: ENABLED | DISABLED | DELETED. */
    status: text('status').notNull(),
    accountId: text('account_id').notNull(),
    evaluationSpec: jsonb('evaluation_spec').notNull(),
    executionSpec: jsonb('execution_spec').notNull(),
    scheduleSpec: jsonb('schedule_spec'),
    rawPayload: jsonb('raw_payload').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('meta_rule_snapshots_connection_idx').on(t.connectionId),
    index('meta_rule_snapshots_rule_idx').on(t.ruleId),
    index('meta_rule_snapshots_fetched_idx').on(t.fetchedAt),
  ],
);

export type MetaRuleSnapshot = typeof metaRuleSnapshots.$inferSelect;
export type NewMetaRuleSnapshot = typeof metaRuleSnapshots.$inferInsert;
