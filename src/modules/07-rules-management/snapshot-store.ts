import { and, desc, eq } from 'drizzle-orm';
import { db } from '../00-foundation/index.js';
import {
  metaRuleSnapshots,
  type MetaRuleSnapshot,
} from '../../db/schema/meta-rule-snapshots.js';
import type {
  EvaluationSpec,
  ExecutionSpec,
  MetaRuleStatus,
  ScheduleSpec,
} from './schema.js';
import type { RuleApiPayload } from './meta-rules.js';

export async function saveRuleSnapshot(
  connectionId: string,
  payload: RuleApiPayload,
): Promise<MetaRuleSnapshot> {
  const [row] = await db
    .insert(metaRuleSnapshots)
    .values({
      connectionId,
      ruleId: payload.id,
      name: payload.name,
      status: payload.status,
      accountId: payload.accountId,
      evaluationSpec: payload.evaluationSpec as never,
      executionSpec: payload.executionSpec as never,
      scheduleSpec: (payload.scheduleSpec ?? null) as never,
      rawPayload: (payload.raw ?? null) as never,
    })
    .returning();
  if (!row) {
    throw new Error('Failed to insert meta_rule_snapshot');
  }
  return row;
}

/**
 * Records a tombstone snapshot when a rule is deleted at Meta. We do not GET
 * after delete (the object is gone), so we record what we know.
 */
export async function saveDeletedRuleSnapshot(
  connectionId: string,
  ruleId: string,
  previous: MetaRuleSnapshot | null,
): Promise<MetaRuleSnapshot> {
  const [row] = await db
    .insert(metaRuleSnapshots)
    .values({
      connectionId,
      ruleId,
      name: previous?.name ?? '(deleted)',
      status: 'DELETED' satisfies MetaRuleStatus,
      accountId: previous?.accountId ?? '',
      evaluationSpec: (previous?.evaluationSpec ?? {}) as never,
      executionSpec: (previous?.executionSpec ?? {}) as never,
      scheduleSpec: (previous?.scheduleSpec ?? null) as never,
      rawPayload: { deleted: true, deletedAt: new Date().toISOString() } as never,
    })
    .returning();
  if (!row) {
    throw new Error('Failed to insert deletion snapshot');
  }
  return row;
}

export async function findLatestSnapshot(
  connectionId: string,
  ruleId: string,
): Promise<MetaRuleSnapshot | null> {
  const [row] = await db
    .select()
    .from(metaRuleSnapshots)
    .where(
      and(
        eq(metaRuleSnapshots.connectionId, connectionId),
        eq(metaRuleSnapshots.ruleId, ruleId),
      ),
    )
    .orderBy(desc(metaRuleSnapshots.fetchedAt))
    .limit(1);
  return row ?? null;
}

export async function listLatestSnapshots(
  connectionId: string,
): Promise<MetaRuleSnapshot[]> {
  // Pull all and dedupe to latest-per-rule client-side. For higher volume we
  // can swap to a window function; current scale doesn't justify the SQL.
  const rows = await db
    .select()
    .from(metaRuleSnapshots)
    .where(eq(metaRuleSnapshots.connectionId, connectionId))
    .orderBy(desc(metaRuleSnapshots.fetchedAt));

  const seen = new Set<string>();
  const out: MetaRuleSnapshot[] = [];
  for (const r of rows) {
    if (seen.has(r.ruleId)) continue;
    seen.add(r.ruleId);
    out.push(r);
  }
  return out;
}

export interface ParsedSnapshot {
  snapshot: MetaRuleSnapshot;
  evaluationSpec: EvaluationSpec;
  executionSpec: ExecutionSpec;
  scheduleSpec: ScheduleSpec | null;
}

export function parseSnapshot(s: MetaRuleSnapshot): ParsedSnapshot {
  return {
    snapshot: s,
    evaluationSpec: s.evaluationSpec as EvaluationSpec,
    executionSpec: s.executionSpec as ExecutionSpec,
    scheduleSpec: (s.scheduleSpec as ScheduleSpec | null) ?? null,
  };
}
