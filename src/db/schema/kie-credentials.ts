import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';

export const kieCredentialStatusEnum = pgEnum('kie_credential_status', [
  'active',
  'invalid',
  'credits_exhausted',
]);

export const kieCredentials = pgTable(
  'kie_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: text('label').notNull(),
    apiKey: text('api_key').notNull(),
    status: kieCredentialStatusEnum('status').notNull().default('active'),
    invalidReason: text('invalid_reason'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('kie_credentials_status_idx').on(t.status)],
);

export type KieCredential = typeof kieCredentials.$inferSelect;
export type NewKieCredential = typeof kieCredentials.$inferInsert;
