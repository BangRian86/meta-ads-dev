import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema/index.js';

export const queryClient = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  onnotice: (notice) => logger.debug({ notice }, 'pg notice'),
});

export const db = drizzle(queryClient, { schema, logger: config.isDev });
export type DB = typeof db;
export { schema };

export async function pingDb(): Promise<void> {
  await db.execute(sql`select 1`);
}

export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
