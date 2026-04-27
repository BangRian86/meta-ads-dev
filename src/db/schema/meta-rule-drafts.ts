// TODO(adoption): Tabel ini belum dipakai di production (0 row per audit
// 2026-04-27). Schema + modul 07-rules-management sudah lengkap; menunggu
// adopsi operator untuk mulai create draft via /rules Telegram command
// atau dashboard. Hapus TODO ini saat row pertama tercipta.
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

export const ruleDraftStatusIntentEnum = pgEnum('rule_draft_status_intent', [
  'enabled',
  'disabled',
]);

export const ruleDraftStateEnum = pgEnum('rule_draft_state', [
  'draft',
  'published',
  'discarded',
]);

export const metaRuleDrafts = pgTable(
  'meta_rule_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    statusIntent: ruleDraftStatusIntentEnum('status_intent')
      .notNull()
      .default('disabled'),
    state: ruleDraftStateEnum('state').notNull().default('draft'),
    evaluationSpec: jsonb('evaluation_spec').notNull(),
    executionSpec: jsonb('execution_spec').notNull(),
    scheduleSpec: jsonb('schedule_spec'),
    notes: text('notes'),
    /** Set when state transitions to 'published'. */
    publishedRuleId: text('published_rule_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('meta_rule_drafts_connection_idx').on(t.connectionId),
    index('meta_rule_drafts_state_idx').on(t.state),
    index('meta_rule_drafts_published_rule_idx').on(t.publishedRuleId),
  ],
);

export type MetaRuleDraft = typeof metaRuleDrafts.$inferSelect;
export type NewMetaRuleDraft = typeof metaRuleDrafts.$inferInsert;
