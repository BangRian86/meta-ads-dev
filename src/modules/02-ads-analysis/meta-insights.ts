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
import type { Target, DateRange } from './schema.js';

const INSIGHT_FIELDS = [
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpm',
  'cpc',
  'reach',
  'frequency',
  'actions',
  'cost_per_action_type',
  'date_start',
  'date_stop',
].join(',');

export interface ActionValue {
  action_type: string;
  value: string;
}

export interface RawInsightRow {
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  cpc?: string;
  reach?: string;
  frequency?: string;
  actions?: ActionValue[];
  cost_per_action_type?: ActionValue[];
  date_start?: string;
  date_stop?: string;
}

export interface InsightFetchResult {
  rows: RawInsightRow[];
  raw: unknown;
}

export async function fetchInsights(
  connectionId: string,
  target: Target,
  range: DateRange,
): Promise<InsightFetchResult> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${target.id}/insights`);
  url.searchParams.set('fields', INSIGHT_FIELDS);
  url.searchParams.set(
    'time_range',
    JSON.stringify({ since: range.since, until: range.until }),
  );
  url.searchParams.set('level', target.type);
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
      await logRequest(conn.id, target, status, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new Error(
        `Meta insights fetch failed: ${mapped.code} ${mapped.message}`,
      );
    }

    await logRequest(conn.id, target, status, payload, null, Date.now() - start);
    const data =
      (payload as { data?: RawInsightRow[] } | null)?.data ?? [];
    return { rows: data, raw: payload };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (status === 0) {
      logger.error({ err, target }, 'Network error fetching insights');
      await logRequest(
        conn.id,
        target,
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
  target: Target,
  status: number,
  body: unknown,
  mapped: MappedMetaError | null,
  durationMs: number,
  errorMessage?: string,
): Promise<void> {
  try {
    await db.insert(metaRequestLogs).values({
      connectionId,
      method: 'GET',
      endpoint: `/${target.id}/insights`,
      requestParams: { targetType: target.type } as never,
      responseStatus: status,
      responseBody: (body ?? (errorMessage ? { error: errorMessage } : null)) as never,
      errorCode: mapped?.code ?? null,
      errorSubcode: mapped?.subcode ?? null,
      errorKind: mapped?.kind ?? null,
      durationMs,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to write meta_request_logs row (insights)');
  }
}
