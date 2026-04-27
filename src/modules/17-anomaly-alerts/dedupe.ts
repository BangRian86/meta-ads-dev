import { eq, sql } from 'drizzle-orm';
import { db } from '../00-foundation/index.js';
import { alertDedupe } from '../../db/schema/alert-dedupe.js';

const COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * True when this `alertKey` has been sent within the cooldown window.
 * Caller should skip the send when true. Idempotent — does NOT update the
 * last_sent_at row.
 */
export async function isOnCooldown(alertKey: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(alertDedupe)
    .where(eq(alertDedupe.alertKey, alertKey))
    .limit(1);
  if (!row) return false;
  return Date.now() - row.lastSentAt.getTime() < COOLDOWN_MS;
}

/**
 * Records that an alert with this key was just sent. Upserts on conflict so
 * the row always reflects the most recent send time.
 */
export async function markSent(alertKey: string): Promise<void> {
  await db
    .insert(alertDedupe)
    .values({ alertKey })
    .onConflictDoUpdate({
      target: alertDedupe.alertKey,
      set: { lastSentAt: sql`now()` },
    });
}
