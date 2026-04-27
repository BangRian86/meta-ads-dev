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

export const pendingActionStatusEnum = pgEnum('pending_action_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
  'executed',
  'failed',
]);

export const pendingActions = pgTable(
  'pending_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    status: pendingActionStatusEnum('status').notNull().default('pending'),
    /** Free-form action discriminator; matched in module 12 dispatcher. */
    actionKind: text('action_kind').notNull(),
    /** Action-specific params used by the executor when approved. */
    payload: jsonb('payload').notNull(),
    /** Display strings for the confirmation message + /pending list. */
    summary: jsonb('summary').notNull(),
    /** 'telegram' for manual commands, 'auto-optimizer' for cron-triggered. */
    requestedBy: text('requested_by'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    executedResult: jsonb('executed_result'),
    errorMessage: text('error_message'),
    /** Filtered out of /pending and confirmation flow once past this time. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('pending_actions_status_idx').on(t.status),
    index('pending_actions_expires_idx').on(t.expiresAt),
    index('pending_actions_created_idx').on(t.createdAt),
  ],
);

export type PendingAction = typeof pendingActions.$inferSelect;
export type NewPendingAction = typeof pendingActions.$inferInsert;
