import { appConfig as config } from '../00-foundation/index.js';
import { logger } from '../00-foundation/index.js';
import {
  requireActiveConnection,
  markInvalid,
  TokenInvalidError,
} from '../00-foundation/index.js';
import {
  mapHttpFailure,
  mapMetaError,
  type MappedMetaError,
} from '../00-foundation/index.js';
import { db } from '../00-foundation/index.js';
import { metaRequestLogs } from '../../db/schema/index.js';
import type {
  MetaStatus,
  MetaEffectiveStatus,
  ObjectRef,
  ObjectType,
} from './schema.js';

const FIELDS_BY_TYPE: Record<ObjectType, string> = {
  campaign: 'id,status,effective_status',
  adset: 'id,status,effective_status,campaign_id',
  ad: 'id,status,effective_status,adset_id,campaign_id',
};

export interface MetaObjectStatus {
  id: string;
  status: MetaStatus;
  effectiveStatus: MetaEffectiveStatus;
  campaignId?: string;
  adsetId?: string;
}

interface RawObjectResponse {
  id?: string;
  status?: string;
  effective_status?: string;
  campaign_id?: string;
  adset_id?: string;
}

export async function fetchObject(
  connectionId: string,
  target: ObjectRef,
): Promise<MetaObjectStatus> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${target.id}`);
  url.searchParams.set('fields', FIELDS_BY_TYPE[target.type]);
  url.searchParams.set('access_token', conn.accessToken);

  const start = Date.now();
  let status = 0;
  let payload: unknown = null;

  try {
    const res = await fetch(url, { method: 'GET' });
    status = res.status;
    payload = await res.json().catch(() => null);

    if (!res.ok) {
      const mapped = payload
        ? mapMetaError(payload)
        : mapHttpFailure(status, res.statusText, payload);
      await logRequest(conn.id, target, 'GET', null, status, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new Error(
        `Meta object fetch failed (${target.type} ${target.id}): ${mapped.code} ${mapped.message}`,
      );
    }

    await logRequest(conn.id, target, 'GET', null, status, payload, null, Date.now() - start);
    return parseObject(payload as RawObjectResponse | null, target);
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (status === 0) {
      logger.error({ err, target }, 'Network error fetching Meta object');
      await logRequest(
        conn.id,
        target,
        'GET',
        null,
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

function parseObject(
  raw: RawObjectResponse | null,
  target: ObjectRef,
): MetaObjectStatus {
  if (!raw || !raw.id) {
    throw new Error(`Meta returned empty payload for ${target.type} ${target.id}`);
  }
  const status = (raw.status ?? '') as MetaStatus;
  const effectiveStatus = (raw.effective_status ?? raw.status ?? '') as MetaEffectiveStatus;
  const out: MetaObjectStatus = {
    id: raw.id,
    status,
    effectiveStatus,
  };
  if (raw.campaign_id) out.campaignId = raw.campaign_id;
  if (raw.adset_id) out.adsetId = raw.adset_id;
  return out;
}

async function logRequest(
  connectionId: string,
  target: ObjectRef,
  method: string,
  params: unknown,
  status: number,
  body: unknown,
  mapped: MappedMetaError | null,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  try {
    await db.insert(metaRequestLogs).values({
      connectionId,
      method,
      endpoint: `/${target.id}`,
      requestParams: { targetType: target.type, ...(params as object | null) } as never,
      responseStatus: status,
      responseBody: (body ?? (errorMessage ? { error: errorMessage } : null)) as never,
      errorCode: mapped?.code ?? null,
      errorSubcode: mapped?.subcode ?? null,
      errorKind: mapped?.kind ?? null,
      durationMs,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write meta_request_logs row (object read)');
  }
}
