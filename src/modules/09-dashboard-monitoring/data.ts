import { and, count, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  metaConnections,
  type MetaConnection,
} from '../../db/schema/meta-connections.js';
import {
  kieCredentials,
  type KieCredential,
} from '../../db/schema/kie-credentials.js';
import {
  operationAudits,
  type OperationAudit,
} from '../../db/schema/operation-audits.js';
import {
  metaRequestLogs,
} from '../../db/schema/meta-request-logs.js';
import {
  metaObjectSnapshots,
  type MetaObjectSnapshot,
} from '../../db/schema/meta-object-snapshots.js';
import {
  contentAssets,
  type ContentAsset,
} from '../../db/schema/content-assets.js';

export async function listMetaConnections(): Promise<MetaConnection[]> {
  return db.select().from(metaConnections).orderBy(desc(metaConnections.createdAt));
}

export async function listKieCredentials(): Promise<KieCredential[]> {
  return db.select().from(kieCredentials).orderBy(desc(kieCredentials.createdAt));
}

export async function recentAudits(limit = 25): Promise<OperationAudit[]> {
  return db
    .select()
    .from(operationAudits)
    .orderBy(desc(operationAudits.createdAt))
    .limit(limit);
}

export interface ActivitySummary {
  recentMetaCallsLastHour: number;
  recentAuditsLastHour: number;
  successLastDay: number;
  failureLastDay: number;
  pendingAssets: number;
  processingAssets: number;
}

export async function activitySummary(): Promise<ActivitySummary> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [reqs] = await db
    .select({ c: count() })
    .from(metaRequestLogs)
    .where(gte(metaRequestLogs.createdAt, oneHourAgo));
  const [audits] = await db
    .select({ c: count() })
    .from(operationAudits)
    .where(gte(operationAudits.createdAt, oneHourAgo));
  const [success] = await db
    .select({ c: count() })
    .from(operationAudits)
    .where(
      and(eq(operationAudits.status, 'success'), gte(operationAudits.createdAt, oneDayAgo)),
    );
  const [failed] = await db
    .select({ c: count() })
    .from(operationAudits)
    .where(
      and(eq(operationAudits.status, 'failed'), gte(operationAudits.createdAt, oneDayAgo)),
    );
  const [pending] = await db
    .select({ c: count() })
    .from(contentAssets)
    .where(eq(contentAssets.status, 'pending'));
  const [processing] = await db
    .select({ c: count() })
    .from(contentAssets)
    .where(eq(contentAssets.status, 'processing'));

  return {
    recentMetaCallsLastHour: Number(reqs?.c ?? 0),
    recentAuditsLastHour: Number(audits?.c ?? 0),
    successLastDay: Number(success?.c ?? 0),
    failureLastDay: Number(failed?.c ?? 0),
    pendingAssets: Number(pending?.c ?? 0),
    processingAssets: Number(processing?.c ?? 0),
  };
}

export interface CampaignRow {
  snapshot: MetaObjectSnapshot;
  adSetCount: number;
}

export async function listCampaigns(connectionId?: string): Promise<CampaignRow[]> {
  const conditions = [eq(metaObjectSnapshots.objectType, 'campaign')];
  if (connectionId) conditions.push(eq(metaObjectSnapshots.connectionId, connectionId));

  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(and(...conditions))
    .orderBy(desc(metaObjectSnapshots.fetchedAt));

  // Latest snapshot per campaign id
  const seen = new Set<string>();
  const campaigns: MetaObjectSnapshot[] = [];
  for (const r of rows) {
    if (seen.has(r.objectId)) continue;
    seen.add(r.objectId);
    campaigns.push(r);
  }

  // Compute adset counts per campaign (latest snapshot per adset)
  const adsetSnapshots = await db
    .select()
    .from(metaObjectSnapshots)
    .where(eq(metaObjectSnapshots.objectType, 'adset'))
    .orderBy(desc(metaObjectSnapshots.fetchedAt));
  const latestAdsetByCampaign = new Map<string, Set<string>>();
  const seenAdset = new Set<string>();
  for (const a of adsetSnapshots) {
    if (seenAdset.has(a.objectId)) continue;
    seenAdset.add(a.objectId);
    if (!a.campaignId) continue;
    if (!latestAdsetByCampaign.has(a.campaignId)) {
      latestAdsetByCampaign.set(a.campaignId, new Set());
    }
    latestAdsetByCampaign.get(a.campaignId)!.add(a.objectId);
  }

  return campaigns.map((c) => ({
    snapshot: c,
    adSetCount: latestAdsetByCampaign.get(c.objectId)?.size ?? 0,
  }));
}

export interface CampaignDetailData {
  campaign: MetaObjectSnapshot | null;
  adSets: Array<{ snapshot: MetaObjectSnapshot; ads: MetaObjectSnapshot[] }>;
}

export async function campaignDetail(
  campaignId: string,
): Promise<CampaignDetailData> {
  const [campaign] = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.objectType, 'campaign'),
        eq(metaObjectSnapshots.objectId, campaignId),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt))
    .limit(1);

  const adSetRows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.objectType, 'adset'),
        eq(metaObjectSnapshots.campaignId, campaignId),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt));
  const seenAdset = new Set<string>();
  const adSets: MetaObjectSnapshot[] = [];
  for (const r of adSetRows) {
    if (seenAdset.has(r.objectId)) continue;
    seenAdset.add(r.objectId);
    adSets.push(r);
  }

  const adRows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.objectType, 'ad'),
        eq(metaObjectSnapshots.campaignId, campaignId),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt));
  const seenAd = new Set<string>();
  const adsByAdset = new Map<string, MetaObjectSnapshot[]>();
  for (const r of adRows) {
    if (seenAd.has(r.objectId)) continue;
    seenAd.add(r.objectId);
    if (!r.parentId) continue;
    if (!adsByAdset.has(r.parentId)) adsByAdset.set(r.parentId, []);
    adsByAdset.get(r.parentId)!.push(r);
  }

  return {
    campaign: campaign ?? null,
    adSets: adSets.map((s) => ({ snapshot: s, ads: adsByAdset.get(s.objectId) ?? [] })),
  };
}

export async function listRecentAssets(limit = 50): Promise<ContentAsset[]> {
  return db
    .select()
    .from(contentAssets)
    .orderBy(desc(contentAssets.createdAt))
    .limit(limit);
}

export type AssetTypeFilter = 'all' | 'image' | 'video';
export type AssetStatusFilter = 'all' | 'success' | 'failed' | 'in_progress' | 'expired';

export interface ListAssetsFilters {
  type?: AssetTypeFilter;
  status?: AssetStatusFilter;
  connectionId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedAssets {
  rows: ContentAsset[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listAssetsFiltered(
  filters: ListAssetsFilters,
): Promise<PaginatedAssets> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(100, filters.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (filters.type === 'image') {
    conditions.push(
      inArray(contentAssets.assetType, ['image_generated', 'image_edited']),
    );
  } else if (filters.type === 'video') {
    conditions.push(
      inArray(contentAssets.assetType, ['video_generated', 'video_image_to_video']),
    );
  }
  if (filters.status === 'success') {
    conditions.push(eq(contentAssets.status, 'success'));
  } else if (filters.status === 'failed') {
    conditions.push(eq(contentAssets.status, 'failed'));
  } else if (filters.status === 'in_progress') {
    conditions.push(inArray(contentAssets.status, ['pending', 'processing']));
  } else if (filters.status === 'expired') {
    conditions.push(eq(contentAssets.status, 'expired'));
  }
  if (filters.connectionId) {
    conditions.push(eq(contentAssets.connectionId, filters.connectionId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ c } = { c: 0 }] = await db
    .select({ c: count() })
    .from(contentAssets)
    .where(where);
  const total = Number(c ?? 0);

  const rows = await db
    .select()
    .from(contentAssets)
    .where(where)
    .orderBy(desc(contentAssets.createdAt))
    .limit(pageSize)
    .offset(offset);

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface AssetCounts {
  total: number;
  byStatus: Record<string, number>;
}

export async function assetCounts(): Promise<AssetCounts> {
  const rows = await db
    .select({ status: contentAssets.status, c: count() })
    .from(contentAssets)
    .groupBy(contentAssets.status);
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const c = Number(r.c);
    byStatus[r.status] = c;
    total += c;
  }
  return { total, byStatus };
}

// ---------- Mutations exposed to the dashboard ----------

export interface AddMetaConnectionInput {
  accountName: string;
  adAccountId: string;
  accessToken: string;
  metaUserId?: string;
}

export async function addMetaConnection(
  input: AddMetaConnectionInput,
): Promise<MetaConnection> {
  const [row] = await db
    .insert(metaConnections)
    .values({
      accountName: input.accountName,
      adAccountId: input.adAccountId,
      accessToken: input.accessToken,
      metaUserId: input.metaUserId ?? null,
    })
    .returning();
  if (!row) throw new Error('Failed to insert meta_connections row');
  return row;
}

export async function setMetaConnectionToken(
  connectionId: string,
  accessToken: string,
): Promise<void> {
  await db
    .update(metaConnections)
    .set({
      accessToken,
      status: 'active',
      invalidReason: null,
      lastValidatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(metaConnections.id, connectionId));
}

export async function setMetaConnectionName(
  connectionId: string,
  name: string,
): Promise<void> {
  await db
    .update(metaConnections)
    .set({ accountName: name, updatedAt: new Date() })
    .where(eq(metaConnections.id, connectionId));
}

export interface AddKieCredentialInput {
  label: string;
  apiKey: string;
}

export async function addKieCredential(
  input: AddKieCredentialInput,
): Promise<KieCredential> {
  const [row] = await db
    .insert(kieCredentials)
    .values({ label: input.label, apiKey: input.apiKey })
    .returning();
  if (!row) throw new Error('Failed to insert kie_credentials row');
  return row;
}

export async function setKieCredentialKey(
  credentialId: string,
  apiKey: string,
): Promise<void> {
  await db
    .update(kieCredentials)
    .set({
      apiKey,
      status: 'active',
      invalidReason: null,
      lastValidatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(kieCredentials.id, credentialId));
}

// ---------- Audiences (live from Meta API per connection) ----------

export interface AudienceRow {
  connectionId: string;
  accountName: string;
  adAccountId: string;
  audienceId: string;
  name: string;
  subtype: string | null;
  approximateCount: number | null;
  deliveryStatus: string | null;
  operationStatus: string | null;
}

export interface AudienceListResult {
  rows: AudienceRow[];
  errors: Array<{ connectionId: string; accountName: string; message: string }>;
}

export async function listAudiences(
  connectionId?: string,
): Promise<AudienceListResult> {
  // Lazy-import to avoid pulling auto-optimizer at module-load time.
  const { listMetaAudiences } = await import(
    '../11-auto-optimizer/audience-creator.js'
  );

  const conns = await db
    .select()
    .from(metaConnections)
    .where(
      connectionId
        ? eq(metaConnections.id, connectionId)
        : eq(metaConnections.status, 'active'),
    )
    .orderBy(desc(metaConnections.createdAt));

  const rows: AudienceRow[] = [];
  const errors: AudienceListResult['errors'] = [];

  for (const conn of conns) {
    if (conn.status !== 'active') continue;
    try {
      const list = await listMetaAudiences(conn.id);
      for (const a of list) {
        rows.push({
          connectionId: conn.id,
          accountName: conn.accountName,
          adAccountId: conn.adAccountId,
          audienceId: a.id,
          name: a.name,
          subtype: a.subtype,
          approximateCount: a.approximateCount,
          deliveryStatus: a.deliveryStatus,
          operationStatus: a.operationStatus,
        });
      }
    } catch (err) {
      errors.push({
        connectionId: conn.id,
        accountName: conn.accountName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { rows, errors };
}

// ---------- Workflow component statuses ----------

export interface WorkflowComponent {
  id: string;
  label: string;
  description: string;
  active: boolean;
  lastRunAt: Date | null;
  detail: string | null;
}

export async function workflowComponents(): Promise<WorkflowComponent[]> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [syncRow] = await db
    .select({ at: sql<Date>`max(${metaObjectSnapshots.fetchedAt})` })
    .from(metaObjectSnapshots);
  const [optimizerRow] = await db
    .select({ at: sql<Date>`max(${operationAudits.createdAt})` })
    .from(operationAudits)
    .where(sql`${operationAudits.operationType} like 'optimizer.%'`);
  const [approvalRow] = await db
    .select({ c: count() })
    .from(operationAudits)
    .where(
      and(
        sql`${operationAudits.operationType} like 'pending.%'`,
        gte(operationAudits.createdAt, oneDayAgo),
      ),
    );
  const [executeRow] = await db
    .select({ at: sql<Date>`max(${operationAudits.createdAt})` })
    .from(operationAudits);
  const [analyzeRow] = await db
    .select({ at: sql<Date>`max(${operationAudits.createdAt})` })
    .from(operationAudits)
    .where(sql`${operationAudits.operationType} like 'analysis.%'`);
  const [notifyRow] = await db
    .select({ at: sql<Date>`max(${operationAudits.createdAt})` })
    .from(operationAudits)
    .where(sql`${operationAudits.operationType} like '%notify%' or ${operationAudits.operationType} like '%alert%'`);

  const lastSync = parseDate(syncRow?.at);
  const lastOptimizer = parseDate(optimizerRow?.at);
  const lastExecute = parseDate(executeRow?.at);
  const lastAnalyze = parseDate(analyzeRow?.at);
  const lastNotify = parseDate(notifyRow?.at);
  const approvalCount24h = Number(approvalRow?.c ?? 0);

  return [
    {
      id: 'sync',
      label: 'Sync',
      description: 'Pulls campaigns, ad sets and ads from Meta into local snapshots.',
      active: lastSync != null && Date.now() - lastSync.getTime() < 6 * 60 * 60 * 1000,
      lastRunAt: lastSync,
      detail: 'Cron: maa-optimizer (every 3 hours)',
    },
    {
      id: 'analyze',
      label: 'Analyze',
      description: 'Reads insights and rule snapshots; flags problems.',
      active: lastAnalyze != null,
      lastRunAt: lastAnalyze,
      detail: 'Triggered by optimizer + analysis flows',
    },
    {
      id: 'optimize',
      label: 'Optimize',
      description: 'Auto-optimizer evaluates rules and proposes actions.',
      active: lastOptimizer != null && Date.now() - lastOptimizer.getTime() < 6 * 60 * 60 * 1000,
      lastRunAt: lastOptimizer,
      detail: 'Cron: maa-optimizer (every 3 hours)',
    },
    {
      id: 'notify',
      label: 'Notify',
      description: 'Sends Telegram alerts and progress reports.',
      active: lastNotify != null,
      lastRunAt: lastNotify,
      detail: 'Cron: maa-meta-progress, maa-sheets-alerts, maa-daily-summary',
    },
    {
      id: 'approve',
      label: 'Approve',
      description: 'Human-in-the-loop approval queue.',
      active: approvalCount24h > 0,
      lastRunAt: null,
      detail: `${approvalCount24h} actions queued in last 24h`,
    },
    {
      id: 'execute',
      label: 'Execute',
      description: 'Applies approved actions back to Meta (start/stop/budget).',
      active: lastExecute != null,
      lastRunAt: lastExecute,
      detail: 'Triggered by approval queue + optimizer',
    },
  ];
}

export interface CronJobStatus {
  id: string;
  schedule: string;
  command: string;
  description: string;
  lastRunAt: Date | null;
}

export async function cronJobsStatus(): Promise<CronJobStatus[]> {
  const fs = await import('node:fs/promises');
  const jobs: Array<Omit<CronJobStatus, 'lastRunAt'> & { logPath: string }> = [
    {
      id: 'maa-optimizer',
      schedule: '0 */3 * * *',
      command: 'maa-optimizer',
      description: 'Sync + evaluate + apply auto-optimizer.',
      logPath: '/tmp/maa-optimizer.log',
    },
    {
      id: 'maa-meta-progress',
      schedule: '0 4,9,14 * * *',
      command: 'maa-meta-progress',
      description: '3x daily progress report (Telegram).',
      logPath: '/tmp/maa-meta-progress.log',
    },
    {
      id: 'maa-sheets-alerts',
      schedule: '0 0 * * *',
      command: 'maa-sheets-alerts',
      description: 'Daily Sheets-based ROAS alerts.',
      logPath: '/tmp/maa-sheets-alerts.log',
    },
    {
      id: 'maa-sheets-daily',
      schedule: '0 2 * * *',
      command: 'maa-sheets-daily',
      description: 'Daily Sheets summary report.',
      logPath: '/tmp/maa-sheets-daily.log',
    },
    {
      id: 'maa-daily-summary',
      schedule: '0 0 * * *',
      command: 'maa-daily-summary',
      description: 'Daily summary digest.',
      logPath: '/tmp/maa-daily-summary.log',
    },
  ];

  const out: CronJobStatus[] = [];
  for (const j of jobs) {
    let lastRunAt: Date | null = null;
    try {
      const stat = await fs.stat(j.logPath);
      lastRunAt = stat.mtime;
    } catch {
      /* log not present yet */
    }
    out.push({
      id: j.id,
      schedule: j.schedule,
      command: j.command,
      description: j.description,
      lastRunAt,
    });
  }
  return out;
}

function parseDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Suppress unused-import warning for sql tag if future queries need it.
export const _sqlTag = sql;
