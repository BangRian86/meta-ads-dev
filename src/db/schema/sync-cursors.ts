import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { metaConnections } from './meta-connections.js';

/**
 * Cursor per (connection, object_type) untuk incremental sync.
 *
 * Saat ini sync masih full-fetch (ambil semua campaign tiap pass), tapi
 * tabel ini disediakan supaya nanti bisa migrasi ke delta sync (Meta
 * filter `updated_since`). Sync runner update cursor_value setelah pass
 * sukses; pass berikutnya pakai cursor untuk filter.
 *
 * Contoh row:
 *   { connection_id: ..., object_type: 'campaign', cursor_value: '2026-04-26T08:00:00Z' }
 *
 * cursor_value sengaja text — bisa berisi ISO timestamp, opaque token
 * dari API, atau monotonic ID. Format tergantung object_type.
 */
export const syncCursors = pgTable(
  'sync_cursors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => metaConnections.id, { onDelete: 'cascade' }),
    /** 'campaign' | 'adset' | 'ad' | 'insight' | future custom types. */
    objectType: text('object_type').notNull(),
    cursorValue: text('cursor_value').notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One cursor per (connection, object_type) — upsert pattern.
    unique('sync_cursors_conn_type_uniq').on(t.connectionId, t.objectType),
    index('sync_cursors_synced_idx').on(t.lastSyncedAt),
  ],
);

export type SyncCursor = typeof syncCursors.$inferSelect;
export type NewSyncCursor = typeof syncCursors.$inferInsert;
