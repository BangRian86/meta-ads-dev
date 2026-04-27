import { and, desc, eq, gt, like, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  pendingActions,
  type PendingAction,
} from '../../db/schema/pending-actions.js';
import type { EnqueueInput } from './schema.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export async function enqueue(input: EnqueueInput): Promise<PendingAction> {
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);
  const [row] = await db
    .insert(pendingActions)
    .values({
      connectionId: input.connectionId,
      actionKind: input.actionKind,
      payload: input.payload as never,
      summary: input.summary as never,
      requestedBy: input.requestedBy,
      expiresAt,
    })
    .returning();
  if (!row) throw new Error('Failed to enqueue pending action');
  return row;
}

/** Returns all live (pending + not expired) rows, newest first. */
export async function listLivePending(): Promise<PendingAction[]> {
  const now = new Date();
  return db
    .select()
    .from(pendingActions)
    .where(
      and(eq(pendingActions.status, 'pending'), gt(pendingActions.expiresAt, now)),
    )
    .orderBy(desc(pendingActions.createdAt));
}

/** Resolves a row by short-id (first 8 chars of UUID). Returns null if no
 *  match or if the match is past its expiry. */
export async function findByShortId(shortId: string): Promise<PendingAction | null> {
  if (!/^[a-f0-9]{6,8}$/i.test(shortId)) return null;
  const now = new Date();
  const [row] = await db
    .select()
    .from(pendingActions)
    .where(
      and(
        like(sql`${pendingActions.id}::text`, `${shortId.toLowerCase()}%`),
        eq(pendingActions.status, 'pending'),
        gt(pendingActions.expiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findOnlyLivePending(): Promise<PendingAction | null> {
  const all = await listLivePending();
  if (all.length === 1) return all[0]!;
  return null;
}

export async function markApproved(
  pendingId: string,
  decidedBy: string,
): Promise<PendingAction | null> {
  const [row] = await db
    .update(pendingActions)
    .set({ status: 'approved', decidedBy, decidedAt: new Date() })
    .where(
      and(eq(pendingActions.id, pendingId), eq(pendingActions.status, 'pending')),
    )
    .returning();
  return row ?? null;
}

export async function markRejected(
  pendingId: string,
  decidedBy: string,
): Promise<PendingAction | null> {
  const [row] = await db
    .update(pendingActions)
    .set({ status: 'rejected', decidedBy, decidedAt: new Date() })
    .where(
      and(eq(pendingActions.id, pendingId), eq(pendingActions.status, 'pending')),
    )
    .returning();
  return row ?? null;
}

export async function markExecuted(
  pendingId: string,
  result: unknown,
): Promise<void> {
  await db
    .update(pendingActions)
    .set({
      status: 'executed',
      executedAt: new Date(),
      executedResult: result as never,
    })
    .where(eq(pendingActions.id, pendingId));
}

export async function markFailed(pendingId: string, error: string): Promise<void> {
  await db
    .update(pendingActions)
    .set({
      status: 'failed',
      executedAt: new Date(),
      errorMessage: error,
    })
    .where(eq(pendingActions.id, pendingId));
}

export function shortId(p: PendingAction): string {
  return p.id.slice(0, 8);
}
