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
  CampaignFields,
  AdSetFields,
  AdFields,
  ObjectType,
} from './schema.js';

const ALWAYS_PAUSED = 'PAUSED' as const;

export async function createCampaignAtMeta(
  connectionId: string,
  fields: CampaignFields,
): Promise<{ id: string; raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/act_${conn.adAccountId}/campaigns`);
  const body = new URLSearchParams();
  body.set('name', fields.name);
  body.set('objective', fields.objective);
  body.set('status', ALWAYS_PAUSED);
  body.set('special_ad_categories', JSON.stringify(fields.specialAdCategories));
  if (fields.buyingType) body.set('buying_type', fields.buyingType);
  if (fields.dailyBudgetMinor != null) {
    body.set('daily_budget', String(fields.dailyBudgetMinor));
  }
  if (fields.lifetimeBudgetMinor != null) {
    body.set('lifetime_budget', String(fields.lifetimeBudgetMinor));
  }
  if (fields.bidStrategy) body.set('bid_strategy', fields.bidStrategy);
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(
    conn.id,
    url,
    body,
    `/act_${conn.adAccountId}/campaigns`,
    { op: 'create', objectType: 'campaign', name: fields.name },
  );
  return extractIdAndRaw(result.payload);
}

export async function createAdSetAtMeta(
  connectionId: string,
  fields: AdSetFields,
): Promise<{ id: string; raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/act_${conn.adAccountId}/adsets`);
  const body = new URLSearchParams();
  body.set('name', fields.name);
  body.set('campaign_id', fields.campaignId);
  body.set('status', ALWAYS_PAUSED);
  body.set('billing_event', fields.billingEvent);
  body.set('optimization_goal', fields.optimizationGoal);
  body.set('targeting', JSON.stringify(fields.targeting));
  if (fields.dailyBudgetMinor != null) {
    body.set('daily_budget', String(fields.dailyBudgetMinor));
  }
  if (fields.lifetimeBudgetMinor != null) {
    body.set('lifetime_budget', String(fields.lifetimeBudgetMinor));
  }
  if (fields.bidAmountMinor != null) {
    body.set('bid_amount', String(fields.bidAmountMinor));
  }
  if (fields.startTime) body.set('start_time', fields.startTime);
  if (fields.endTime) body.set('end_time', fields.endTime);
  if (fields.promotedObject) {
    body.set('promoted_object', JSON.stringify(fields.promotedObject));
  }
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(
    conn.id,
    url,
    body,
    `/act_${conn.adAccountId}/adsets`,
    { op: 'create', objectType: 'adset', name: fields.name, campaignId: fields.campaignId },
  );
  return extractIdAndRaw(result.payload);
}

export async function createAdAtMeta(
  connectionId: string,
  fields: AdFields,
): Promise<{ id: string; raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/act_${conn.adAccountId}/ads`);
  const body = new URLSearchParams();
  body.set('name', fields.name);
  body.set('adset_id', fields.adsetId);
  body.set('status', ALWAYS_PAUSED);
  if (fields.creative.creativeId) {
    body.set('creative', JSON.stringify({ creative_id: fields.creative.creativeId }));
  } else if (fields.creative.creativeSpec) {
    body.set('creative', JSON.stringify(fields.creative.creativeSpec));
  }
  if (fields.trackingSpecs) {
    body.set('tracking_specs', JSON.stringify(fields.trackingSpecs));
  }
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(
    conn.id,
    url,
    body,
    `/act_${conn.adAccountId}/ads`,
    { op: 'create', objectType: 'ad', name: fields.name, adsetId: fields.adsetId },
  );
  return extractIdAndRaw(result.payload);
}

export interface CopyOptions {
  rename?: { prefix?: string; suffix?: string };
}

/**
 * Calls Meta's `/copies` endpoint. Always passes status_option=PAUSED so the
 * duplicate (and any deep-copied children) start paused regardless of source.
 */
export async function copyObjectAtMeta(
  connectionId: string,
  type: ObjectType,
  sourceId: string,
  opts: CopyOptions = {},
): Promise<{ id: string; raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${sourceId}/copies`);
  const body = new URLSearchParams();
  // Deep copy makes sense for campaign/adset; ad has no children.
  if (type !== 'ad') body.set('deep_copy', 'true');
  body.set('status_option', 'PAUSED');
  if (opts.rename?.prefix || opts.rename?.suffix) {
    body.set(
      'rename_options',
      JSON.stringify({
        rename_strategy: 'DEEP_RENAME',
        rename_prefix: opts.rename.prefix ?? '',
        rename_suffix: opts.rename.suffix ?? '',
      }),
    );
  }
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(
    conn.id,
    url,
    body,
    `/${sourceId}/copies`,
    { op: 'duplicate', objectType: type, sourceId },
  );
  const id = extractCopiedId(result.payload, type);
  if (!id) {
    throw new Error(`Meta copy response missing id for ${type} ${sourceId}`);
  }
  return { id, raw: result.payload };
}

export async function deleteObjectAtMeta(
  connectionId: string,
  objectId: string,
): Promise<{ raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${objectId}`);
  url.searchParams.set('access_token', conn.accessToken);

  const start = Date.now();
  let respStatus = 0;
  let payload: unknown = null;

  try {
    const res = await fetch(url, { method: 'DELETE' });
    respStatus = res.status;
    payload = await res.json().catch(() => null);
    if (!res.ok) {
      const mapped = payload
        ? mapMetaError(payload)
        : mapHttpFailure(respStatus, res.statusText, payload);
      await logRequest(conn.id, 'DELETE', `/${objectId}`, { op: 'delete' }, respStatus, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new Error(`Meta delete failed (${objectId}): ${mapped.code} ${mapped.message}`);
    }
    await logRequest(conn.id, 'DELETE', `/${objectId}`, { op: 'delete' }, respStatus, payload, null, Date.now() - start);
    return { raw: payload };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (respStatus === 0) {
      logger.error({ err, objectId }, 'Network error deleting Meta object');
      await logRequest(
        conn.id,
        'DELETE',
        `/${objectId}`,
        { op: 'delete' },
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

function extractIdAndRaw(payload: unknown): { id: string; raw: unknown } {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Meta create response is empty or not an object');
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Meta create response missing id');
  }
  return { id, raw: payload };
}

function extractCopiedId(payload: unknown, type: ObjectType): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const keyByType: Record<ObjectType, string> = {
    campaign: 'copied_campaign_id',
    adset: 'copied_adset_id',
    ad: 'copied_ad_id',
  };
  const key = keyByType[type];
  const v = obj[key] ?? obj.id;
  return typeof v === 'string' ? v : null;
}

async function postOrThrow(
  connectionId: string,
  url: URL,
  body: URLSearchParams,
  endpoint: string,
  reqMeta: Record<string, unknown>,
): Promise<{ payload: unknown }> {
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
      await logRequest(connectionId, 'POST', endpoint, reqMeta, respStatus, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(connectionId, mapped.code, mapped.message);
        throw new TokenInvalidError(connectionId, mapped.code, mapped);
      }
      throw new Error(`Meta create/copy failed (${endpoint}): ${mapped.code} ${mapped.message}`);
    }

    await logRequest(connectionId, 'POST', endpoint, reqMeta, respStatus, payload, null, Date.now() - start);
    return { payload };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (respStatus === 0) {
      logger.error({ err, endpoint, reqMeta }, 'Network error in Meta create/copy');
      await logRequest(
        connectionId,
        'POST',
        endpoint,
        reqMeta,
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
    logger.error({ err }, 'Failed to write meta_request_logs row (manage-campaigns)');
  }
}
