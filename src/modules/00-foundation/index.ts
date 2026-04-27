/**
 * 00-foundation — cross-cutting infrastructure layer.
 *
 * Modul ini berisi concerns yang dipakai oleh modul lain (01-99):
 *   - auth          → Meta connection token management
 *   - config        → environment configuration
 *   - database      → Drizzle DB instance + lifecycle
 *   - audit         → operation_audits writer (recordAudit / withAudit)
 *   - error-mapper  → normalize provider error responses
 *   - provider-client → base HTTP wrapper untuk external providers
 *   - snapshot-repository → generic snapshot reads
 *   - job-dispatcher → pg-boss job queue
 *
 * Module lain HARUS import via `'../00-foundation/index.js'` untuk
 * concerns ini — bukan langsung dari `src/lib/*` atau `src/config/*`.
 *
 * Selama transition window (file lama belum dihapus), import lama tetap
 * bekerja. Migrasi gradual modul satu per satu.
 *
 * Lihat blueprint.md + PRD.md di folder ini untuk detail arsitektur +
 * roadmap migrasi.
 */

export * as auth from './auth.js';
export * as audit from './audit.js';
export * as config from './config.js';
export * as database from './database.js';
export * as errorMapper from './error-mapper.js';
export * as providerClient from './provider-client.js';
export * as snapshotRepository from './snapshot-repository.js';
export * as jobDispatcher from './job-dispatcher.js';

// Convenience direct re-exports — frequently-used singletons biar
// nggak perlu nested namespace.
export { db, schema, pingDb, closeDb } from './database.js';
export { config as appConfig } from './config.js';
export { TokenInvalidError } from './auth.js';
export { recordAudit, withAudit } from './audit.js';
// Logger — singleton pino instance, dipakai hampir semua modul.
export { logger } from '../../lib/logger.js';
