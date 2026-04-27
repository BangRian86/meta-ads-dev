import {
  appConfig as config,
  db,
  logger,
  mapHttpFailure,
  mapMetaError,
  markInvalid,
  requireActiveConnection,
  TokenInvalidError,
  withAudit,
  type MappedMetaError,
} from '../00-foundation/index.js';
import { metaRequestLogs } from '../../db/schema/index.js';
import {
  createEngagementAudienceInputSchema,
  createLookalikeInputSchema,
  type CreateEngagementAudienceInput,
  type CreateLookalikeInput,
} from './schema.js';

export interface AudienceCreated {
  id: string;
  name: string;
  raw: unknown;
}

/**
 * Creates an engagement-based custom audience (IG or FB page).
 * Always wrapped in withAudit so the operation_audits row is canonical.
 */
export async function createEngagementAudience(
  rawInput: CreateEngagementAudienceInput,
): Promise<AudienceCreated> {
  const input = createEngagementAudienceInputSchema.parse(rawInput);
  const conn = await requireActiveConnection(input.connectionId);

  const rule = buildEngagementRule(
    input.sourceType,
    input.sourceId,
    input.retentionDays,
  );

  const created = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'audience.engagement.create',
      targetType: 'custom_audience',
      actorId: input.actorId ?? null,
      requestBody: {
        name: input.name,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        retentionDays: input.retentionDays,
      },
    },
    async () => {
      const url = new URL(
        `${config.meta.graphUrl}/act_${conn.adAccountId}/customaudiences`,
      );
      const body = new URLSearchParams();
      body.set('name', input.name);
      body.set('subtype', 'ENGAGEMENT');
      body.set('rule', JSON.stringify(rule));
      body.set('access_token', conn.accessToken);
      const r = await postAudience(
        conn.id,
        url,
        body,
        `/act_${conn.adAccountId}/customaudiences`,
        { op: 'engagement_audience', sourceType: input.sourceType },
      );
      return parseAudience(r.payload, input.name);
    },
    (a) => a.id,
  );

  return created;
}

/**
 * Creates one or more lookalike audiences from a source custom audience.
 * Each ratio gets its own Meta call (Meta does support multi-ratio in a single
 * lookalike_spec, but per-ratio calls give a cleaner audit row per audience).
 */
export async function createLookalike(
  rawInput: CreateLookalikeInput,
): Promise<AudienceCreated[]> {
  const input = createLookalikeInputSchema.parse(rawInput);
  const conn = await requireActiveConnection(input.connectionId);
  const out: AudienceCreated[] = [];

  for (const ratio of input.ratios) {
    const ratioPct = Math.round(ratio * 100);
    const audienceName = `${input.name} - LAL ${ratioPct}%`;
    const created = await withAudit(
      {
        connectionId: input.connectionId,
        operationType: 'audience.lookalike.create',
        targetType: 'custom_audience',
        actorId: input.actorId ?? null,
        requestBody: {
          name: audienceName,
          originAudienceId: input.originAudienceId,
          country: input.country,
          ratio,
        },
      },
      async () => {
        const url = new URL(
          `${config.meta.graphUrl}/act_${conn.adAccountId}/customaudiences`,
        );
        const body = new URLSearchParams();
        body.set('name', audienceName);
        body.set('subtype', 'LOOKALIKE');
        body.set('origin_audience_id', input.originAudienceId);
        body.set(
          'lookalike_spec',
          JSON.stringify({ type: 'similarity', ratio, country: input.country }),
        );
        body.set('access_token', conn.accessToken);
        const r = await postAudience(
          conn.id,
          url,
          body,
          `/act_${conn.adAccountId}/customaudiences`,
          { op: 'lookalike', ratio, country: input.country },
        );
        return parseAudience(r.payload, audienceName);
      },
      (a) => a.id,
    );
    out.push(created);
  }
  return out;
}

/**
 * Combined engagement audience: pulls IG and/or FB engagers (whichever IDs are
 * configured on the connection row) into one custom audience. Sources are
 * read from `meta_connections.page_id` and `.ig_business_id` so each ad
 * account uses its own brand's page/IG. Optional input overrides for
 * one-off cases.
 */
export interface MultiSourceEngagementInput {
  connectionId: string;
  retentionDays: 30 | 60 | 90;
  name: string;
  /** Override the connection's page_id for this call (rare). */
  pageIdOverride?: string | undefined;
  /** Override the connection's ig_business_id for this call (rare). */
  igBusinessIdOverride?: string | undefined;
  actorId?: string | undefined;
}

export async function createMultiSourceEngagementAudience(
  input: MultiSourceEngagementInput,
): Promise<AudienceCreated> {
  const conn = await requireActiveConnection(input.connectionId);
  const pageId = input.pageIdOverride ?? conn.pageId ?? null;
  const igBusinessId = input.igBusinessIdOverride ?? conn.igBusinessId ?? null;

  if (!pageId && !igBusinessId) {
    throw new Error(
      `No engagement sources configured for connection ${input.connectionId}: ` +
        `set meta_connections.page_id and/or .ig_business_id`,
    );
  }

  const rules: unknown[] = [];
  const retentionSeconds = input.retentionDays * 24 * 60 * 60;
  if (igBusinessId) {
    rules.push({
      event_sources: [{ id: igBusinessId, type: 'ig_business' }],
      retention_seconds: retentionSeconds,
      filter: {
        operator: 'and',
        filters: [{ field: 'event', operator: 'eq', value: 'ig_business_profile' }],
      },
    });
  }
  if (pageId) {
    rules.push({
      event_sources: [{ id: pageId, type: 'page' }],
      retention_seconds: retentionSeconds,
      filter: {
        operator: 'and',
        filters: [{ field: 'event', operator: 'eq', value: 'page_engaged' }],
      },
    });
  }
  const rule = { inclusions: { operator: 'or', rules } };

  return withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'audience.engagement.create_multi',
      targetType: 'custom_audience',
      actorId: input.actorId ?? null,
      requestBody: {
        name: input.name,
        retentionDays: input.retentionDays,
        sources: { ig: igBusinessId ?? null, fb: pageId ?? null },
      },
    },
    async () => {
      const url = new URL(
        `${config.meta.graphUrl}/act_${conn.adAccountId}/customaudiences`,
      );
      const body = new URLSearchParams();
      body.set('name', input.name);
      body.set('subtype', 'ENGAGEMENT');
      body.set('rule', JSON.stringify(rule));
      body.set('access_token', conn.accessToken);
      const r = await postAudience(
        conn.id,
        url,
        body,
        `/act_${conn.adAccountId}/customaudiences`,
        { op: 'engagement_audience_multi', retentionDays: input.retentionDays },
      );
      return parseAudience(r.payload, input.name);
    },
    (a) => a.id,
  );
}

export interface MetaAudienceListEntry {
  id: string;
  name: string;
  subtype: string | null;
  approximateCount: number | null;
  deliveryStatus: string | null;
  operationStatus: string | null;
  raw: unknown;
}

/**
 * Lists custom audiences in the connection's ad account. Single-page (top
 * 200) — Meta surface usually fits, and Telegram /audiences only shows ~20
 * anyway. Reads via fetch (not via withAudit; this is read-only).
 */
export async function listMetaAudiences(
  connectionId: string,
): Promise<MetaAudienceListEntry[]> {
  const conn = await requireActiveConnection(connectionId);
  const url = new URL(`${config.meta.graphUrl}/act_${conn.adAccountId}/customaudiences`);
  url.searchParams.set(
    'fields',
    'id,name,subtype,approximate_count_lower_bound,delivery_status,operation_status',
  );
  url.searchParams.set('limit', '200');
  url.searchParams.set('access_token', conn.accessToken);

  const start = Date.now();
  let httpStatus = 0;
  let payload: unknown = null;

  try {
    const res = await fetch(url, { method: 'GET' });
    httpStatus = res.status;
    payload = await res.json().catch(() => null);

    if (!res.ok) {
      const mapped = payload
        ? mapMetaError(payload)
        : mapHttpFailure(httpStatus, res.statusText, payload);
      await logRequest(
        conn.id,
        `/act_${conn.adAccountId}/customaudiences`,
        { op: 'list_audiences' },
        httpStatus,
        payload,
        mapped,
        Date.now() - start,
      );
      if (mapped.requiresTokenReplacement) {
        await markInvalid(conn.id, mapped.code, mapped.message);
        throw new TokenInvalidError(conn.id, mapped.code, mapped);
      }
      throw new Error(`Meta list-audiences failed: ${mapped.code} ${mapped.message}`);
    }
    await logRequest(
      conn.id,
      `/act_${conn.adAccountId}/customaudiences`,
      { op: 'list_audiences' },
      httpStatus,
      payload,
      null,
      Date.now() - start,
    );
    const data = (payload as { data?: unknown[] } | null)?.data ?? [];
    return data.map(parseAudienceListEntry);
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (httpStatus === 0) {
      logger.error({ err }, 'Network error listing Meta audiences');
      await logRequest(
        conn.id,
        `/act_${conn.adAccountId}/customaudiences`,
        { op: 'list_audiences' },
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

function parseAudienceListEntry(raw: unknown): MetaAudienceListEntry {
  const o = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
  const status = (o.delivery_status as { description?: unknown } | undefined)?.description;
  const opStatus = (o.operation_status as { description?: unknown } | undefined)?.description;
  return {
    id: typeof o.id === 'string' ? o.id : '',
    name: typeof o.name === 'string' ? o.name : '',
    subtype: typeof o.subtype === 'string' ? o.subtype : null,
    approximateCount:
      typeof o.approximate_count_lower_bound === 'number'
        ? o.approximate_count_lower_bound
        : null,
    deliveryStatus: typeof status === 'string' ? status : null,
    operationStatus: typeof opStatus === 'string' ? opStatus : null,
    raw,
  };
}

function buildEngagementRule(
  sourceType: 'instagram' | 'facebook',
  sourceId: string,
  retentionDays: number,
): unknown {
  const eventField = sourceType === 'instagram' ? 'ig_business_profile' : 'page_engaged';
  const sourceTypeMeta = sourceType === 'instagram' ? 'ig_business' : 'page';
  return {
    inclusions: {
      operator: 'or',
      rules: [
        {
          event_sources: [{ id: sourceId, type: sourceTypeMeta }],
          retention_seconds: retentionDays * 24 * 60 * 60,
          filter: {
            operator: 'and',
            filters: [{ field: 'event', operator: 'eq', value: eventField }],
          },
        },
      ],
    },
  };
}

function parseAudience(payload: unknown, fallbackName: string): AudienceCreated {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Meta audience response is empty or not an object');
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Meta audience response missing id');
  }
  return { id, name: fallbackName, raw: payload };
}

async function postAudience(
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
      await logRequest(connectionId, endpoint, reqMeta, respStatus, payload, mapped, Date.now() - start);
      if (mapped.requiresTokenReplacement) {
        await markInvalid(connectionId, mapped.code, mapped.message);
        throw new TokenInvalidError(connectionId, mapped.code, mapped);
      }
      throw new Error(`Meta audience write failed: ${mapped.code} ${mapped.message}`);
    }
    await logRequest(connectionId, endpoint, reqMeta, respStatus, payload, null, Date.now() - start);
    return { payload };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    if (respStatus === 0) {
      logger.error({ err, endpoint, reqMeta }, 'Network error creating audience');
      await logRequest(
        connectionId,
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
      method: 'POST',
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
    logger.error({ err }, 'Failed to write meta_request_logs row (audience)');
  }
}
