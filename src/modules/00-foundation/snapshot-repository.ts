/**
 * 00-foundation snapshot-repository — generic accessor untuk snapshot
 * tables (meta_object_snapshots + meta_insight_snapshots).
 *
 * SCOPE V1 (saat ini):
 * - Helper buat ambil "latest snapshot per object" — pattern yang
 *   sebelumnya di-duplicate di module 02, 11, 14, 30.
 * - Re-export insight snapshot store dari 02-ads-analysis.
 *
 * Module lama yang masih punya helper sendiri (misal
 * `loadActiveCampaignSnapshots` di banyak tempat) tetap jalan; foundation
 * menyediakan single canonical version yang module baru harus pakai.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { metaObjectSnapshots, type MetaObjectSnapshot } from '../../db/schema/meta-object-snapshots.js';

export type ObjectType = 'campaign' | 'adset' | 'ad';

/**
 * Latest snapshot per object_id untuk satu connection + object type.
 * Ordering by fetched_at desc + dedup by object_id (Map insertion order
 * preserves first-seen, jadi entry pertama = latest).
 */
export async function loadLatestSnapshots(
  connectionId: string,
  objectType: ObjectType,
): Promise<MetaObjectSnapshot[]> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, objectType),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt));
  const latest = new Map<string, MetaObjectSnapshot>();
  for (const r of rows) {
    if (!latest.has(r.objectId)) latest.set(r.objectId, r);
  }
  return [...latest.values()];
}

/** Filter out non-ACTIVE rows post-load. */
export async function loadActiveSnapshots(
  connectionId: string,
  objectType: ObjectType,
): Promise<MetaObjectSnapshot[]> {
  const all = await loadLatestSnapshots(connectionId, objectType);
  return all.filter((s) => s.status === 'ACTIVE');
}

/** Map child_id → parent (e.g. ad → adset). Useful untuk
 *  reconstruct hierarchy tanpa N+1 queries. */
export async function loadParentMapping(
  connectionId: string,
  childType: 'adset' | 'ad',
): Promise<Map<string, string>> {
  const all = await loadLatestSnapshots(connectionId, childType);
  const out = new Map<string, string>();
  for (const r of all) {
    if (r.parentId) out.set(r.objectId, r.parentId);
  }
  return out;
}

// Re-export insight snapshot store untuk one-stop import.
export {
  findFreshSnapshot,
  saveSnapshot,
  extractRowsFromSnapshot,
  type SnapshotPayload,
} from '../02-ads-analysis/snapshot-store.js';
