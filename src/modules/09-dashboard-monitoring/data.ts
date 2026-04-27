import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
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

// Suppress unused-import warning for sql tag if future queries need it.
export const _sqlTag = sql;
