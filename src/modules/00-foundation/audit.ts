/**
 * 00-foundation audit — operation_audits writer + withAudit wrapper.
 *
 * Sebelumnya implementation di `src/lib/audit-logger.ts` sebagai legacy
 * top-level lib. Dipindah ke foundation April 2026 saat src/lib/*
 * dihapus.
 */

import { db } from '../../db/index.js';
import { operationAudits } from '../../db/schema/index.js';
import { logger } from './logger.js';
import { mapMetaError } from './error-mapper.js';

export interface AuditContext {
  connectionId: string;
  /** e.g. "campaign.create", "adset.update", "ad.pause" */
  operationType: string;
  /** "campaign" | "adset" | "ad" | "creative" | ... */
  targetType: string;
  /** Meta object id once known; may be null for create-before-id ops. */
  targetId?: string | null;
  /** Optional actor identifier (user id, system tag). */
  actorId?: string | null;
  /** Sanitized request payload — do NOT include access tokens. */
  requestBody?: unknown;
}

export interface AuditOutcome {
  status: 'success' | 'failed';
  responseBody?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Resolved targetId if it became known during the operation (e.g. on create). */
  targetId?: string | null;
  durationMs: number;
}

export async function recordAudit(
  ctx: AuditContext,
  outcome: AuditOutcome,
): Promise<void> {
  try {
    await db.insert(operationAudits).values({
      connectionId: ctx.connectionId,
      operationType: ctx.operationType,
      targetType: ctx.targetType,
      targetId: outcome.targetId ?? ctx.targetId ?? null,
      status: outcome.status,
      requestBody: (ctx.requestBody ?? null) as never,
      responseBody: (outcome.responseBody ?? null) as never,
      errorCode: outcome.errorCode ?? null,
      errorMessage: outcome.errorMessage ?? null,
      actorId: ctx.actorId ?? null,
      durationMs: outcome.durationMs,
    });
  } catch (err) {
    // Audit failures must not break the main flow, but they are loud.
    logger.error({ err, ctx, outcome }, 'Failed to write operation_audits row');
  }
}

/**
 * Wraps a write operation so every call is audited. The wrapper:
 *  - times the call
 *  - records success with the response body
 *  - records failure with normalized error code/message (Meta errors mapped via error-mapper)
 *  - re-throws the original error so callers can react
 */
export async function withAudit<T>(
  ctx: AuditContext,
  fn: () => Promise<T>,
  resolveTargetId?: (result: T) => string | null | undefined,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    await recordAudit(ctx, {
      status: 'success',
      responseBody: result,
      targetId: resolveTargetId?.(result) ?? ctx.targetId ?? null,
      durationMs: Date.now() - start,
    });
    return result;
  } catch (err) {
    const mapped = tryMap(err);
    await recordAudit(ctx, {
      status: 'failed',
      errorCode: mapped?.code ?? extractCode(err),
      errorMessage: mapped?.message ?? extractMessage(err),
      durationMs: Date.now() - start,
    });
    throw err;
  }
}

function tryMap(err: unknown) {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as { response?: unknown; body?: unknown; data?: unknown };
  const candidate = anyErr.response ?? anyErr.body ?? anyErr.data ?? err;
  const mapped = mapMetaError(candidate);
  return mapped.code === 'no_error_payload' ? null : mapped;
}

function extractCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
  }
  return null;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'unknown error';
}
