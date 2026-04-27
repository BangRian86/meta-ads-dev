import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { metaConnections } from './meta-connections.js';
import { copyBriefs } from './copy-briefs.js';

export const copyVariantStatusEnum = pgEnum('copy_variant_status', [
  'draft',
  'approved',
  'rejected',
]);

export const copyVariantStrategyEnum = pgEnum('copy_variant_strategy', [
  'heuristic',
  'manual',
  'reviewed_existing',
]);

export const copyVariants = pgTable(
  'copy_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    briefId: uuid('brief_id').references(() => copyBriefs.id, {
      onDelete: 'set null',
    }),
    /** Monotonic per brief_id; 1 for ad-hoc (no brief). */
    version: integer('version').notNull(),
    /** Self-reference (no FK constraint to keep inserts simple). */
    parentId: uuid('parent_id'),
    status: copyVariantStatusEnum('status').notNull().default('draft'),
    strategy: copyVariantStrategyEnum('strategy').notNull(),
    primaryText: text('primary_text').notNull(),
    headline: text('headline').notNull(),
    description: text('description'),
    cta: text('cta').notNull(),
    language: text('language'),
    /** { clarity, emotionalAppeal, ctaStrength, relevance, overall } 0-100. */
    reviewScore: jsonb('review_score'),
    /** { strengths: string[], improvements: string[], perDimension: [...] } */
    reviewNotes: jsonb('review_notes'),
    metadata: jsonb('metadata'),
    createdBy: text('created_by'),
    statusChangedBy: text('status_changed_by'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('copy_variants_brief_idx').on(t.briefId, t.version),
    index('copy_variants_connection_idx').on(t.connectionId),
    index('copy_variants_status_idx').on(t.status),
    index('copy_variants_parent_idx').on(t.parentId),
  ],
);

export type CopyVariant = typeof copyVariants.$inferSelect;
export type NewCopyVariant = typeof copyVariants.$inferInsert;
