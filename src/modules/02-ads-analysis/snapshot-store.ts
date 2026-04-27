import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  metaInsightSnapshots,
  type MetaInsightSnapshot,
} from '../../db/schema/meta-insight-snapshots.js';
import { config } from '../../config/env.js';
import type {
  Target,
  DateRange,
  PerformanceSummary,
} from './schema.js';
import type { RawInsightRow } from './meta-insights.js';

export interface SnapshotPayload {
  rows: RawInsightRow[];
  raw: unknown;
}

export async function findFreshSnapshot(
  target: Target,
  range: DateRange,
  ttlMs: number = config.insightSnapshotTtlMs,
): Promise<MetaInsightSnapshot | null> {
  const [row] = await db
    .select()
    .from(metaInsightSnapshots)
    .where(
      and(
        eq(metaInsightSnapshots.targetType, target.type),
        eq(metaInsightSnapshots.targetId, target.id),
        eq(metaInsightSnapshots.dateStart, range.since),
        eq(metaInsightSnapshots.dateStop, range.until),
      ),
    )
    .orderBy(desc(metaInsightSnapshots.fetchedAt))
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.fetchedAt.getTime() > ttlMs) return null;
  return row;
}

export async function saveSnapshot(
  connectionId: string,
  target: Target,
  range: DateRange,
  payload: SnapshotPayload,
  summary: PerformanceSummary,
): Promise<MetaInsightSnapshot> {
  const [row] = await db
    .insert(metaInsightSnapshots)
    .values({
      connectionId,
      targetType: target.type,
      targetId: target.id,
      dateStart: range.since,
      dateStop: range.until,
      rawPayload: payload as never,
      summary: summary as never,
    })
    .returning();
  if (!row) {
    throw new Error('Failed to insert meta_insight_snapshot');
  }
  return row;
}

export function extractRowsFromSnapshot(
  snapshot: MetaInsightSnapshot,
): RawInsightRow[] {
  const payload = snapshot.rawPayload as
    | { rows?: RawInsightRow[] }
    | null;
  return payload?.rows ?? [];
}
