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
import type { ObjectType } from './schema.js';

const FIELDS_BY_TYPE: Record<ObjectType, string> = {
  // daily_budget / lifetime_budget di campaign-level = CBO; absent / "0" = ABO
  // (budget hidup di adset). Dibaca by ai-context buat jawab pertanyaan budget.
  campaign: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,account_id,created_time,updated_time',
  // destination_type lets module 14-meta-progress infer the channel
  // (WHATSAPP / WEBSITE / MESSENGER) for per-objective benchmarking.
  adset: 'id,name,status,effective_status,destination_type,optimization_goal,daily_budget,lifetime_budget,campaign_id,account_id,created_time,updated_time',
  ad: 'id,name,status,effective_status,adset_id,campaign_id,account_id,created_time,updated_time',
};

export interface ObjectReadResult {
  id: string;
  type: ObjectType;
  name: string;
  status: string;
  effectiveStatus: string;
  campaignId: string | null;
  parentId: string | null;
  adAccountId: string;
  raw: unknown;
}

/**
 * Carries the mapped Meta error so callers can branch by `kind`
 * (e.g. skip-on-rate_limit) without parsing string messages.
 */
export class MetaApiError extends Error {
  override readonly name = 'MetaApiError';
  constructor(
    public readonly mapped: MappedMetaError,
    public readonly endpoint: string,
  ) {
    super(`Meta ${endpoint} failed: ${mapped.code} ${mapped.message}`);
  }
}

/** Min gap between consecutive listChildren calls. Meta's per-account rate
 *  limit on this account fires at ~150 GET/hour; 500ms paces us at ~120/min,
 *  giving headroom plus retry budget. */
const LIST_CHILDREN_DELAY_MS = 500;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchObject(
  connectionId: string,
  type: ObjectType,
  id: string,
): Promise<ObjectReadResult> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${id}`);
  url.searchParams.set('fields', FIELDS_BY_TYPE[type]);
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
      await logRequest(conn.id, 'GET', `/${id}`, { op: 'read', objectType: type }, status, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new MetaApiError(mapped, `read ${type} ${id}`);
    }
    await logRequest(conn.id, 'GET', `/${id}`, { op: 'read', objectType: type }, status, payload, null, Date.now() - start);
    return parseObject(payload, type);
  } catch (err) {
    if (err instanceof TokenInvalidError || err instanceof MetaApiError) throw err;
    if (status === 0) {
      logger.error({ err, type, id }, 'Network error reading Meta object');
      await logRequest(
        conn.id,
        'GET',
        `/${id}`,
        { op: 'read', objectType: type },
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

/**
 * Lists every campaign under the connection's ad account, paging through Meta's
 * cursor-based responses. Each row is returned in the same `ObjectReadResult`
 * shape as `fetchObject`, so callers can persist snapshots directly.
 */
export async function listAccountCampaigns(
  connectionId: string,
): Promise<ObjectReadResult[]> {
  const conn = await requireActiveConnection(connectionId);
  const out: ObjectReadResult[] = [];
  let pageUrl: URL | null = (() => {
    const u = new URL(`${config.meta.graphUrl}/act_${conn.adAccountId}/campaigns`);
    u.searchParams.set('fields', FIELDS_BY_TYPE.campaign);
    u.searchParams.set('limit', '200');
    u.searchParams.set('access_token', conn.accessToken);
    return u;
  })();

  let pageIndex = 0;
  while (pageUrl) {
    const url: URL = pageUrl;
    // Meta's `paging.next` already includes the access_token; we only set it on
    // the first page above. Either way, every URL here is fully signed.
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
        await logRequest(
          conn.id,
          'GET',
          `/act_${conn.adAccountId}/campaigns`,
          { op: 'list', parent: 'account', page: pageIndex },
          status,
          payload,
          mapped,
          Date.now() - start,
        );
        if (mapped.requiresTokenReplacement) {
          await markInvalid(conn.id, mapped.code, mapped.message);
          throw new TokenInvalidError(conn.id, mapped.code, mapped);
        }
        throw new MetaApiError(mapped, 'list account campaigns');
      }

      await logRequest(
        conn.id,
        'GET',
        `/act_${conn.adAccountId}/campaigns`,
        { op: 'list', parent: 'account', page: pageIndex },
        status,
        payload,
        null,
        Date.now() - start,
      );

      const data = (payload as { data?: unknown[] } | null)?.data ?? [];
      for (const row of data) out.push(parseObject(row, 'campaign'));

      const next = (payload as { paging?: { next?: string } } | null)?.paging?.next;
      pageUrl = typeof next === 'string' && next.length > 0 ? new URL(next) : null;
      pageIndex += 1;
    } catch (err) {
      if (err instanceof TokenInvalidError || err instanceof MetaApiError) throw err;
      if (status === 0) {
        logger.error({ err, page: pageIndex }, 'Network error listing account campaigns');
        await logRequest(
          conn.id,
          'GET',
          `/act_${conn.adAccountId}/campaigns`,
          { op: 'list', parent: 'account', page: pageIndex },
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

  return out;
}

export async function listChildren(
  connectionId: string,
  parentType: 'campaign' | 'adset',
  parentId: string,
): Promise<ObjectReadResult[]> {
  // Throttle: enforce a min gap before every Meta call from this function so
  // bursty per-campaign sweeps don't trip the per-account rate limit.
  await sleep(LIST_CHILDREN_DELAY_MS);

  const conn = await requireActiveConnection(connectionId);
  const childType: ObjectType = parentType === 'campaign' ? 'adset' : 'ad';
  const edge = parentType === 'campaign' ? 'adsets' : 'ads';
  const url = new URL(`${config.meta.graphUrl}/${parentId}/${edge}`);
  url.searchParams.set('fields', FIELDS_BY_TYPE[childType]);
  url.searchParams.set('limit', '500');
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
      await logRequest(conn.id, 'GET', `/${parentId}/${edge}`, { op: 'list', parentType }, status, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new MetaApiError(mapped, `list ${edge} of ${parentType} ${parentId}`);
    }
    await logRequest(conn.id, 'GET', `/${parentId}/${edge}`, { op: 'list', parentType }, status, payload, null, Date.now() - start);
    const data = (payload as { data?: unknown[] } | null)?.data ?? [];
    return data.map((row) => parseObject(row, childType));
  } catch (err) {
    if (err instanceof TokenInvalidError || err instanceof MetaApiError) throw err;
    if (status === 0) {
      logger.error({ err, parentType, parentId }, 'Network error listing children');
      await logRequest(
        conn.id,
        'GET',
        `/${parentId}/${edge}`,
        { op: 'list', parentType },
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

function parseObject(raw: unknown, type: ObjectType): ObjectReadResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Meta returned non-object payload for ${type}`);
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : '';
  if (!id) throw new Error(`Meta ${type} payload missing id`);
  const campaignId = typeof o.campaign_id === 'string' ? o.campaign_id : null;
  const adsetId = typeof o.adset_id === 'string' ? o.adset_id : null;
  const parentId =
    type === 'ad' ? adsetId : type === 'adset' ? campaignId : null;
  return {
    id,
    type,
    name: typeof o.name === 'string' ? o.name : '',
    status: typeof o.status === 'string' ? o.status : '',
    effectiveStatus:
      typeof o.effective_status === 'string'
        ? o.effective_status
        : typeof o.status === 'string'
          ? o.status
          : '',
    campaignId: type === 'campaign' ? id : campaignId,
    parentId,
    adAccountId: typeof o.account_id === 'string' ? o.account_id : '',
    raw,
  };
}

async function logRequest(
  connectionId: string,
  method: string,
  endpoint: string,
  params: Record<string, unknown>,
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
      endpoint,
      requestParams: params as never,
      responseStatus: status,
      responseBody: (body ?? (errorMessage ? { error: errorMessage } : null)) as never,
      errorCode: mapped?.code ?? null,
      errorSubcode: mapped?.subcode ?? null,
      errorKind: mapped?.kind ?? null,
      durationMs,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write meta_request_logs row (manage-campaigns read)');
  }
}
