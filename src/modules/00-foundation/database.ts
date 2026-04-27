/**
 * 00-foundation database — re-export Drizzle DB instance + lifecycle helpers.
 *
 * Single source: `src/db/index.ts` (postgres-js + Drizzle).
 * Foundation layer biar module-level code import via `00-foundation`.
 */
export { db, queryClient, schema, pingDb, closeDb, type DB } from '../../db/index.js';
