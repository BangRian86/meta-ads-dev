import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { metaConnections } from './meta-connections.js';

export const metaRequestLogs = pgTable(
  'meta_request_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id').references(() => metaConnections.id, {
      onDelete: 'set null',
    }),
    method: text('method').notNull(),
    endpoint: text('endpoint').notNull(),
    requestParams: jsonb('request_params'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    errorCode: text('error_code'),
    errorSubcode: text('error_subcode'),
    errorKind: text('error_kind'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meta_request_logs_connection_idx').on(t.connectionId),
    index('meta_request_logs_created_idx').on(t.createdAt),
    index('meta_request_logs_endpoint_idx').on(t.endpoint),
    index('meta_request_logs_error_idx').on(t.errorCode),
  ],
);

export type MetaRequestLog = typeof metaRequestLogs.$inferSelect;
export type NewMetaRequestLog = typeof metaRequestLogs.$inferInsert;
