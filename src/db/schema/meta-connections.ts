import { pgTable, uuid, text, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';

export const connectionStatusEnum = pgEnum('connection_status', [
  'active',
  'invalid',
  'expired',
  'revoked',
]);

export const tokenTypeEnum = pgEnum('token_type', [
  'short_lived',
  'long_lived',
  'system_user',
]);

export const metaConnections = pgTable(
  'meta_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountName: text('account_name').notNull(),
    metaUserId: text('meta_user_id'),
    adAccountId: text('ad_account_id').notNull(),
    accessToken: text('access_token').notNull(),
    /** FB Page ID for engagement-source audiences (per ad account). */
    pageId: text('page_id'),
    /** Instagram business ID for engagement-source audiences. */
    igBusinessId: text('ig_business_id'),
    tokenType: tokenTypeEnum('token_type').notNull().default('long_lived'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: connectionStatusEnum('status').notNull().default('active'),
    invalidReason: text('invalid_reason'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('meta_connections_status_idx').on(t.status),
    index('meta_connections_ad_account_idx').on(t.adAccountId),
  ],
);

export type MetaConnection = typeof metaConnections.$inferSelect;
export type NewMetaConnection = typeof metaConnections.$inferInsert;
