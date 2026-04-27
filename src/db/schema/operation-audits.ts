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

export const auditStatusEnum = pgEnum('audit_status', ['success', 'failed']);

export const operationAudits = pgTable(
  'operation_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'restrict' }),
    operationType: text('operation_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    status: auditStatusEnum('status').notNull(),
    requestBody: jsonb('request_body'),
    responseBody: jsonb('response_body'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    actorId: text('actor_id'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('operation_audits_connection_idx').on(t.connectionId),
    index('operation_audits_target_idx').on(t.targetType, t.targetId),
    index('operation_audits_created_idx').on(t.createdAt),
    index('operation_audits_status_idx').on(t.status),
  ],
);

export type OperationAudit = typeof operationAudits.$inferSelect;
export type NewOperationAudit = typeof operationAudits.$inferInsert;
