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
  BudgetTarget,
  BudgetTargetType,
  BudgetKind,
  MetaStatus,
} from './schema.js';

const FIELDS_BY_TYPE: Record<BudgetTargetType, string> = {
  campaign: 'id,status,daily_budget,lifetime_budget',
  adset: 'id,status,daily_budget,lifetime_budget,campaign_id',
};

export interface BudgetReadResult {
  id: string;
  status: MetaStatus;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  campaignId?: string;
}

interface RawBudgetResponse {
  id?: string;
  status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign_id?: string;
}

export async function readBudget(
  connectionId: string,
  target: BudgetTarget,
): Promise<BudgetReadResult> {
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
        `Meta budget read failed (${target.type} ${target.id}): ${mapped.code} ${mapped.message}`,
      );
    }

    await logRequest(conn.id, target, 'GET', null, status, payload, null, Date.now() - start);
    return parseBudget(payload as RawBudgetResponse | null, target);
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (status === 0) {
      logger.error({ err, target }, 'Network error reading Meta budget');
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

export interface BudgetWriteResult {
  success: boolean;
  raw: unknown;
}

export async function writeBudget(
  connectionId: string,
  target: BudgetTarget,
  kind: BudgetKind,
  amountMinor: number,
): Promise<BudgetWriteResult> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${target.id}`);
  const body = new URLSearchParams();
  body.set(kind === 'daily' ? 'daily_budget' : 'lifetime_budget', String(amountMinor));
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
      await logRequest(
        conn.id,
        target,
        'POST',
        { kind, amountMinor },
        respStatus,
        payload,
        mapped,
        Date.now() - start,
      );
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new Error(
        `Meta budget write failed (${target.type} ${target.id} ${kind}=${amountMinor}): ${mapped.code} ${mapped.message}`,
      );
    }

    await logRequest(
      conn.id,
      target,
      'POST',
      { kind, amountMinor },
      respStatus,
      payload,
      null,
      Date.now() - start,
    );
    const success =
      typeof payload === 'object' && payload !== null && 'success' in payload
        ? (payload as { success: unknown }).success === true
        : true;
    return { success, raw: payload };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (respStatus === 0) {
      logger.error({ err, target, kind, amountMinor }, 'Network error writing Meta budget');
      await logRequest(
        conn.id,
        target,
        'POST',
        { kind, amountMinor },
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

function parseBudget(
  raw: RawBudgetResponse | null,
  target: BudgetTarget,
): BudgetReadResult {
  if (!raw || !raw.id) {
    throw new Error(`Meta returned empty payload for ${target.type} ${target.id}`);
  }
  const out: BudgetReadResult = {
    id: raw.id,
    status: (raw.status ?? 'ACTIVE') as MetaStatus,
    dailyBudgetMinor: parseMinor(raw.daily_budget),
    lifetimeBudgetMinor: parseMinor(raw.lifetime_budget),
  };
  if (raw.campaign_id) out.campaignId = raw.campaign_id;
  return out;
}

function parseMinor(v: string | undefined): number | null {
  if (v == null || v === '' || v === '0') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

async function logRequest(
  connectionId: string,
  target: BudgetTarget,
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
    logger.error({ err }, 'Failed to write meta_request_logs row (budget op)');
  }
}
