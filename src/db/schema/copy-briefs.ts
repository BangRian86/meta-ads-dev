import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { metaConnections } from './meta-connections.js';

export const copyBriefs = pgTable(
  'copy_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    product: text('product'),
    audience: text('audience'),
    /** string[] — main benefit bullets the copy must communicate. */
    keyBenefits: jsonb('key_benefits').notNull().default([]),
    tone: text('tone'),
    /** string[] — words/phrases the copy must avoid (legal, brand, etc.). */
    forbiddenWords: jsonb('forbidden_words').notNull().default([]),
    /** Desired user action: e.g. 'shop_now', 'sign_up'. */
    targetAction: text('target_action'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('copy_briefs_connection_idx').on(t.connectionId)],
);

export type CopyBrief = typeof copyBriefs.$inferSelect;
export type NewCopyBrief = typeof copyBriefs.$inferInsert;
