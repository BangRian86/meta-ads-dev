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
  EvaluationSpec,
  ExecutionSpec,
  MetaRuleStatus,
  ScheduleSpec,
} from './schema.js';

const RULE_FIELDS = [
  'id',
  'name',
  'status',
  'account_id',
  'evaluation_spec',
  'execution_spec',
  'schedule_spec',
  'created_by',
  'created_time',
  'updated_time',
].join(',');

export interface RuleApiPayload {
  id: string;
  name: string;
  status: MetaRuleStatus;
  accountId: string;
  evaluationSpec: EvaluationSpec;
  executionSpec: ExecutionSpec;
  scheduleSpec: ScheduleSpec | null;
  raw: unknown;
}

interface RawRuleResponse {
  id?: string;
  name?: string;
  status?: string;
  account_id?: string;
  evaluation_spec?: unknown;
  execution_spec?: unknown;
  schedule_spec?: unknown;
}

export interface CreateRulePayload {
  name: string;
  status: MetaRuleStatus;
  evaluationSpec: EvaluationSpec;
  executionSpec: ExecutionSpec;
  scheduleSpec?: ScheduleSpec;
}

export interface UpdateRulePayload {
  name?: string;
  status?: MetaRuleStatus;
  evaluationSpec?: EvaluationSpec;
  executionSpec?: ExecutionSpec;
  scheduleSpec?: ScheduleSpec;
}

export async function createRuleAtMeta(
  connectionId: string,
  payload: CreateRulePayload,
): Promise<{ id: string; raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/act_${conn.adAccountId}/adrules_library`);
  const body = buildRuleBody(payload);
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(conn.id, url, body, '/act_x/adrules_library', {
    op: 'create',
    name: payload.name,
  });
  const id = extractRuleId(result.payload);
  if (!id) {
    throw new Error('Meta create-rule response missing id');
  }
  return { id, raw: result.payload };
}

export async function updateRuleAtMeta(
  connectionId: string,
  ruleId: string,
  payload: UpdateRulePayload,
): Promise<{ raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${ruleId}`);
  const body = buildRuleBody(payload);
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(conn.id, url, body, `/${ruleId}`, {
    op: 'update',
    fields: Object.keys(payload),
  });
  return { raw: result.payload };
}

export async function setRuleStatusAtMeta(
  connectionId: string,
  ruleId: string,
  status: 'ENABLED' | 'DISABLED',
): Promise<{ raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${ruleId}`);
  const body = new URLSearchParams();
  body.set('status', status);
  body.set('access_token', conn.accessToken);

  const result = await postOrThrow(conn.id, url, body, `/${ruleId}`, {
    op: 'set_status',
    status,
  });
  return { raw: result.payload };
}

export async function deleteRuleAtMeta(
  connectionId: string,
  ruleId: string,
): Promise<{ raw: unknown }> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${ruleId}`);
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
      await logRequest(conn.id, 'DELETE', `/${ruleId}`, { op: 'delete' }, respStatus, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new Error(`Meta rule delete failed (${ruleId}): ${mapped.code} ${mapped.message}`);
    }

    await logRequest(conn.id, 'DELETE', `/${ruleId}`, { op: 'delete' }, respStatus, payload, null, Date.now() - start);
    return { raw: payload };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (respStatus === 0) {
      logger.error({ err, ruleId }, 'Network error deleting Meta rule');
      await logRequest(
        conn.id,
        'DELETE',
        `/${ruleId}`,
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

export async function fetchRuleFromMeta(
  connectionId: string,
  ruleId: string,
): Promise<RuleApiPayload> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/${ruleId}`);
  url.searchParams.set('fields', RULE_FIELDS);
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
      await logRequest(conn.id, 'GET', `/${ruleId}`, { op: 'read' }, status, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new Error(`Meta rule read failed (${ruleId}): ${mapped.code} ${mapped.message}`);
    }

    await logRequest(conn.id, 'GET', `/${ruleId}`, { op: 'read' }, status, payload, null, Date.now() - start);
    return parseRule(payload as RawRuleResponse | null, ruleId);
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (status === 0) {
      logger.error({ err, ruleId }, 'Network error reading Meta rule');
      await logRequest(
        conn.id,
        'GET',
        `/${ruleId}`,
        { op: 'read' },
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

function buildRuleBody(
  p: CreateRulePayload | UpdateRulePayload,
): URLSearchParams {
  const body = new URLSearchParams();
  if (p.name != null) body.set('name', p.name);
  if (p.status != null) body.set('status', p.status);
  if (p.evaluationSpec != null) body.set('evaluation_spec', JSON.stringify(p.evaluationSpec));
  if (p.executionSpec != null) body.set('execution_spec', JSON.stringify(p.executionSpec));
  if (p.scheduleSpec != null) body.set('schedule_spec', JSON.stringify(p.scheduleSpec));
  return body;
}

function parseRule(raw: RawRuleResponse | null, ruleId: string): RuleApiPayload {
  if (!raw || !raw.id) {
    throw new Error(`Meta returned empty payload for rule ${ruleId}`);
  }
  const status = (raw.status ?? 'DISABLED') as MetaRuleStatus;
  return {
    id: raw.id,
    name: raw.name ?? '',
    status,
    accountId: raw.account_id ?? '',
    evaluationSpec: (raw.evaluation_spec ?? { evaluation_type: 'SCHEDULE', filters: [] }) as EvaluationSpec,
    executionSpec: (raw.execution_spec ?? { execution_type: 'NOTIFICATION' }) as ExecutionSpec,
    scheduleSpec: (raw.schedule_spec as ScheduleSpec | undefined) ?? null,
    raw,
  };
}

function extractRuleId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const v = (payload as { id?: unknown }).id;
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
      throw new Error(`Meta rule write failed (${endpoint}): ${mapped.code} ${mapped.message}`);
    }

    await logRequest(connectionId, 'POST', endpoint, reqMeta, respStatus, payload, null, Date.now() - start);
    return { payload };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (respStatus === 0) {
      logger.error({ err, endpoint, reqMeta }, 'Network error writing Meta rule');
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
    logger.error({ err }, 'Failed to write meta_request_logs row (rule op)');
  }
}
