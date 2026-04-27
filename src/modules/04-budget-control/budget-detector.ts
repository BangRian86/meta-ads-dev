import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { metaObjectSnapshots } from '../../db/schema/meta-object-snapshots.js';
import { readBudget, type BudgetReadResult } from './meta-budget.js';
import type { BudgetSnapshot, BudgetTarget } from './schema.js';

export class BudgetTargetMismatchError extends Error {
  override readonly name = 'BudgetTargetMismatchError';
  constructor(
    public readonly requestedTarget: BudgetTarget,
    public readonly actualOwner: BudgetSnapshot,
  ) {
    super(
      `Budget owner is ${actualOwner.ownerType} ${actualOwner.ownerId} (${actualOwner.level.toUpperCase()}). ` +
        `Cannot change budget on ${requestedTarget.type} ${requestedTarget.id}.`,
    );
  }
}

export class NoBudgetConfiguredError extends Error {
  override readonly name = 'NoBudgetConfiguredError';
  constructor(public readonly target: BudgetTarget) {
    super(
      `No daily or lifetime budget set on ${target.type} ${target.id}. ` +
        `Cannot apply percentage-based change against a zero baseline.`,
    );
  }
}

/**
 * Resolves the actual budget owner for a target. The detector handles three
 * cases:
 *   - target is a campaign with own budget (CBO)        → owner = campaign
 *   - target is an adset under a CBO campaign           → owner = campaign
 *   - target is an adset under an ABO campaign with own → owner = adset
 *
 * For an ABO campaign with no per-target adset specified, the caller must
 * pass the specific adset id; this function will refuse a campaign-level
 * request.
 */
export async function detectBudgetOwner(
  connectionId: string,
  target: BudgetTarget,
): Promise<BudgetSnapshot> {
  if (target.type === 'campaign') {
    const c = await readBudget(connectionId, target);
    if (hasBudget(c)) {
      return {
        ownerType: 'campaign',
        ownerId: c.id,
        campaignId: c.id,
        level: 'cbo',
        dailyBudgetMinor: c.dailyBudgetMinor,
        lifetimeBudgetMinor: c.lifetimeBudgetMinor,
        status: c.status,
      };
    }
    // ABO without an adset id — caller must specify the adset.
    throw new NoBudgetConfiguredError(target);
  }

  // adset target
  const a = await readBudget(connectionId, target);
  if (!a.campaignId) {
    throw new Error(`Adset ${target.id} response missing campaign_id`);
  }
  const c = await readBudget(connectionId, { type: 'campaign', id: a.campaignId });

  if (hasBudget(c)) {
    return {
      ownerType: 'campaign',
      ownerId: c.id,
      campaignId: c.id,
      level: 'cbo',
      dailyBudgetMinor: c.dailyBudgetMinor,
      lifetimeBudgetMinor: c.lifetimeBudgetMinor,
      status: c.status,
    };
  }

  if (!hasBudget(a)) {
    throw new NoBudgetConfiguredError(target);
  }

  return {
    ownerType: 'adset',
    ownerId: a.id,
    campaignId: a.campaignId,
    level: 'abo',
    dailyBudgetMinor: a.dailyBudgetMinor,
    lifetimeBudgetMinor: a.lifetimeBudgetMinor,
    status: a.status,
  };
}

function hasBudget(b: BudgetReadResult): boolean {
  return (
    (b.dailyBudgetMinor != null && b.dailyBudgetMinor > 0) ||
    (b.lifetimeBudgetMinor != null && b.lifetimeBudgetMinor > 0)
  );
}

export interface AdsetBudgetMatch {
  id: string;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
}

/**
 * Walk through known adsets under a campaign (from snapshot DB) and return
 * the first one yang punya budget di level adset (ABO indicator). Return
 * null kalau tidak ada adset yang punya budget — bisa berarti CBO atau
 * campaign yang budget-nya nol di mana-mana.
 *
 * Helper ini awalnya inline di telegram-bot/commands.ts; di-extract
 * supaya runAutoScale (auto-optimizer) bisa pakai untuk distinguish
 * "ABO" vs "broken CBO" sebelum skip.
 */
export async function findFirstAdsetWithBudget(
  connectionId: string,
  campaignId: string,
): Promise<AdsetBudgetMatch | null> {
  const rows = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, connectionId),
        eq(metaObjectSnapshots.objectType, 'adset'),
        eq(metaObjectSnapshots.campaignId, campaignId),
      ),
    );
  // Latest snapshot per adset id (sync writes one row per fetch).
  const seen = new Set<string>();
  const adsetIds: string[] = [];
  for (const r of rows) {
    if (seen.has(r.objectId)) continue;
    seen.add(r.objectId);
    adsetIds.push(r.objectId);
  }
  for (const adsetId of adsetIds) {
    try {
      const owner = await detectBudgetOwner(connectionId, {
        type: 'adset',
        id: adsetId,
      });
      if (owner.ownerType === 'adset' && owner.ownerId === adsetId) {
        return {
          id: adsetId,
          dailyBudgetMinor: owner.dailyBudgetMinor,
          lifetimeBudgetMinor: owner.lifetimeBudgetMinor,
        };
      }
    } catch {
      // No budget on this adset → try next.
      continue;
    }
  }
  return null;
}
