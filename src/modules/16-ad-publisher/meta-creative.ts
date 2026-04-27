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
import { metaRequestLogs } from '../../db/schema/meta-request-logs.js';

/**
 * Subset of an ad's fetched payload that the publish flow actually consumes.
 * Anything else from Meta is left in `raw` for callers that need it.
 */
export interface SourceAdSnapshot {
  adId: string;
  adsetId: string;
  creativeId: string | null;
  /** The creative's full object_story_spec when present. We mutate text
   *  fields inside this and POST a new creative. */
  objectStorySpec: Record<string, unknown> | null;
  /** When the source ad references an existing post via object_story_id
   *  we can't introspect/copy text — caller should error out. */
  hasObjectStoryId: boolean;
  raw: unknown;
}

/**
 * GET /{adId}?fields=adset_id,creative{id,object_story_spec,object_story_id}
 * Returns the fields needed to clone the creative with new copy.
 */
export async function fetchSourceAd(
  connectionId: string,
  adId: string,
): Promise<SourceAdSnapshot> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${adId}`);
  url.searchParams.set(
    'fields',
    'id,adset_id,creative{id,object_story_spec,object_story_id}',
  );
  url.searchParams.set('access_token', conn.accessToken);

  const start = Date.now();
  let respStatus = 0;
  let payload: unknown = null;
  try {
    const res = await fetch(url, { method: 'GET' });
    respStatus = res.status;
    payload = await res.json().catch(() => null);
    if (!res.ok) {
      const mapped = payload
        ? mapMetaError(payload)
        : mapHttpFailure(respStatus, res.statusText, payload);
      await logRequest(
        conn.id,
        'GET',
        `/${adId}`,
        { op: 'fetch_source_ad' },
        respStatus,
        payload,
        mapped,
        Date.now() - start,
      );
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new Error(`Meta fetch ad failed (${adId}): ${mapped.code} ${mapped.message}`);
    }
    await logRequest(
      conn.id,
      'GET',
      `/${adId}`,
      { op: 'fetch_source_ad' },
      respStatus,
      payload,
      null,
      Date.now() - start,
    );

    const obj = (payload ?? {}) as Record<string, unknown>;
    const adsetId = typeof obj.adset_id === 'string' ? obj.adset_id : '';
    const creative = (obj.creative ?? null) as
      | {
          id?: string;
          object_story_spec?: Record<string, unknown>;
          object_story_id?: string;
        }
      | null;

    return {
      adId,
      adsetId,
      creativeId: creative?.id ?? null,
      objectStorySpec: creative?.object_story_spec ?? null,
      hasObjectStoryId: Boolean(creative?.object_story_id),
      raw: payload,
    };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (respStatus === 0) {
      logger.error({ err, adId }, 'Network error fetching source ad');
      await logRequest(
        conn.id,
        'GET',
        `/${adId}`,
        { op: 'fetch_source_ad' },
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

export interface CreatedCreative {
  id: string;
  raw: unknown;
}

/**
 * POST /act_{adAccountId}/adcreatives. Body shape: name + object_story_spec
 * (JSON string). Returns the new creative id Meta assigns.
 */
export async function createCreativeAtMeta(
  connectionId: string,
  name: string,
  objectStorySpec: Record<string, unknown>,
): Promise<CreatedCreative> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(
    `${config.meta.graphUrl}/act_${conn.adAccountId}/adcreatives`,
  );
  const body = new URLSearchParams();
  body.set('name', name);
  body.set('object_story_spec', JSON.stringify(objectStorySpec));
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(
    conn.id,
    url,
    body,
    `/act_${conn.adAccountId}/adcreatives`,
    { op: 'create_creative', name },
  );
  return extractIdAndRaw(result.payload);
}

export interface CreatedAd {
  id: string;
  raw: unknown;
}

/**
 * POST /act_{adAccountId}/ads — creates the ad pointing to the new creative.
 * Always status=PAUSED so review happens before any spend.
 */
export async function createAdFromCreative(
  connectionId: string,
  args: { name: string; adsetId: string; creativeId: string },
): Promise<CreatedAd> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/act_${conn.adAccountId}/ads`);
  const body = new URLSearchParams();
  body.set('name', args.name);
  body.set('adset_id', args.adsetId);
  body.set('status', 'PAUSED');
  body.set(
    'creative',
    JSON.stringify({ creative_id: args.creativeId }),
  );
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(
    conn.id,
    url,
    body,
    `/act_${conn.adAccountId}/ads`,
    { op: 'create_ad', adsetId: args.adsetId, creativeId: args.creativeId },
  );
  return extractIdAndRaw(result.payload);
}

function extractIdAndRaw(payload: unknown): { id: string; raw: unknown } {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Meta create response empty');
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Meta create response missing id');
  }
  return { id, raw: payload };
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
      throw new Error(`Meta create failed (${endpoint}): ${mapped.code} ${mapped.message}`);
    }
    await logRequest(connectionId, 'POST', endpoint, reqMeta, respStatus, payload, null, Date.now() - start);
    return { payload };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (respStatus === 0) {
      logger.error({ err, endpoint, reqMeta }, 'Network error in Meta create (publisher)');
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
    logger.error({ err }, 'Failed to write meta_request_logs row (publisher)');
  }
}
