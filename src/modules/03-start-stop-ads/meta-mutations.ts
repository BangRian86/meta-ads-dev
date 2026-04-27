import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  requireActiveConnection,
  markInvalid,
  TokenInvalidError,
} from '../../lib/auth-manager.js';
import {
  mapHttpFailure,
  mapMetaError,
  type MappedMetaError,
} from '../../lib/error-mapper.js';
import { db } from '../../db/index.js';
import { metaRequestLogs } from '../../db/schema/index.js';
import type { ObjectRef } from './schema.js';

export type WriteStatus = 'ACTIVE' | 'PAUSED';

export interface StatusUpdateResponse {
  success: boolean;
  raw: unknown;
}

export async function setObjectStatus(
  connectionId: string,
  target: ObjectRef,
  status: WriteStatus,
): Promise<StatusUpdateResponse> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${target.id}`);
  const body = new URLSearchParams();
  body.set('status', status);
  body.set('access_token', conn.accessToken);

  const start = Date.now();
  let respStatus = 0;
  let payload: unknown = null;

  try {
    const res = await fetch(url, { method: 'POST', body });
    respStatus = res.status;
    payload = await res.json().catch(() => null);

    if (!res.ok) {
      const mapped = payload
        ? mapMetaError(payload)
        : mapHttpFailure(respStatus, res.statusText, payload);
      await logRequest(conn.id, target, status, respStatus, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new MetaWriteError(
        `Meta status update failed (${target.type} ${target.id} → ${status}): ${mapped.code} ${mapped.message}`,
        mapped,
      );
    }

    await logRequest(conn.id, target, status, respStatus, payload, null, Date.now() - start);
    const success =
      typeof payload === 'object' && payload !== null && 'success' in payload
        ? (payload as { success: unknown }).success === true
        : true;
    return { success, raw: payload };
  } catch (err) {
    if (err instanceof TokenInvalidError || err instanceof MetaWriteError) throw err;
    if (respStatus === 0) {
      logger.error({ err, target, status }, 'Network error writing Meta status');
      await logRequest(
        conn.id,
        target,
        status,
        0,
        payload,
        null,
        Date.now() - start,
        err instanceof Error ? err.message : String(err),
      );
    }
    throw err;
  }
}

export class MetaWriteError extends Error {
  override readonly name = 'MetaWriteError';
  constructor(
    message: string,
    public readonly mapped: MappedMetaError,
  ) {
    super(message);
  }
}

async function logRequest(
  connectionId: string,
  target: ObjectRef,
  desiredStatus: WriteStatus,
  respStatus: number,
  body: unknown,
  mapped: MappedMetaError | null,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  try {
    await db.insert(metaRequestLogs).values({
      connectionId,
      method: 'POST',
      endpoint: `/${target.id}`,
      requestParams: { targetType: target.type, status: desiredStatus } as never,
      responseStatus: respStatus,
      responseBody: (body ?? (errorMessage ? { error: errorMessage } : null)) as never,
      errorCode: mapped?.code ?? null,
      errorSubcode: mapped?.subcode ?? null,
      errorKind: mapped?.kind ?? null,
      durationMs,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write meta_request_logs row (status write)');
  }
}
