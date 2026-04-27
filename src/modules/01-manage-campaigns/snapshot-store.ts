import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  metaObjectSnapshots,
  type MetaObjectSnapshot,
  type NewMetaObjectSnapshot,
} from '../../db/schema/meta-object-snapshots.js';
import type { ObjectReadResult } from './meta-read.js';
import type { ObjectType } from './schema.js';

export async function saveObjectSnapshot(
  connectionId: string,
  result: ObjectReadResult,
): Promise<MetaObjectSnapshot> {
  const values: NewMetaObjectSnapshot = {
    connectionId,
    objectType: result.type,
    objectId: result.id,
    parentId: result.parentId,
    campaignId: result.campaignId,
    adAccountId: result.adAccountId,
    name: result.name,
    status: result.status,
    effectiveStatus: result.effectiveStatus,
    rawPayload: result.raw as never,
  };
  const [row] = await db.insert(metaObjectSnapshots).values(values).returning();
  if (!row) throw new Error('Failed to insert meta_object_snapshot');
  return row;
}

export async function findLatestSnapshot(
  connectionId: string,
  type: ObjectType,
  objectId: string,
): Promise<MetaObjectSnapshot | null> {
  const [row] = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, type),
        eq(metaObjectSnapshots.objectId, objectId),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Returns the latest snapshot for every distinct (objectType, objectId) under
 * a given campaign. Useful for UI hierarchy rendering.
 */
export async function listCampaignHierarchySnapshots(
  connectionId: string,
  campaignId: string,
): Promise<MetaObjectSnapshot[]> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.campaignId, campaignId),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt));

  const seen = new Set<string>();
  const out: MetaObjectSnapshot[] = [];
  for (const r of rows) {
    const key = `${r.objectType}:${r.objectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
