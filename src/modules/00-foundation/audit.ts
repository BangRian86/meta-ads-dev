/**
 * 00-foundation audit — single source of operation_audits writes.
 *
 * Re-export `src/lib/audit-logger.ts`. Untuk feature baru, import dari
 * sini biar audit jadi cross-cutting concern yang konsisten:
 *   - withAudit(ctx, fn) — wrap operasi async + log success/fail otomatis
 *   - recordAudit(ctx, outcome) — manual audit (kalau bukan fn-wrappable)
 */
export { recordAudit, withAudit } from '../../lib/audit-logger.js';
export type { AuditContext, AuditOutcome } from '../../lib/audit-logger.js';
