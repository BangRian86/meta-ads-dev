import { withAudit } from '../00-foundation/index.js';
import { logger } from '../00-foundation/index.js';
import {
  increaseBudgetInputSchema,
  decreaseBudgetInputSchema,
  type IncreaseBudgetInput,
  type DecreaseBudgetInput,
  type BudgetSnapshot,
  type BudgetKind,
} from './schema.js';
import { writeBudget } from './meta-budget.js';
import {
  detectBudgetOwner,
  BudgetTargetMismatchError,
} from './budget-detector.js';
import {
  MAX_INCREASE_PCT,
  assertAboveMinimum,
  assertWithinIncreaseCap,
  deriveTargetAmount,
  pctChange,
  BudgetNotIncreaseError,
  BudgetNotDecreaseError,
} from './budget-rules.js';

export interface BudgetChangeResult {
  outcome: 'success';
  owner: BudgetSnapshot;
  kind: BudgetKind;
  previousMinor: number;
  newMinor: number;
  appliedPct: number;
  reason: string;
}

export async function increaseBudget(
  rawInput: IncreaseBudgetInput,
): Promise<BudgetChangeResult> {
  const input = increaseBudgetInputSchema.parse(rawInput);
  const owner = await detectBudgetOwner(input.connectionId, input.target);

  if (owner.ownerType !== input.target.type || owner.ownerId !== input.target.id) {
    throw new BudgetTargetMismatchError(input.target, owner);
  }

  const { kind, currentMinor } = pickActiveBudget(owner);
  const newMinor = deriveTargetAmount(currentMinor, 'up', input.pct, input.newAmountMinor);

  if (newMinor <= currentMinor) {
    throw new BudgetNotIncreaseError(currentMinor, newMinor);
  }

  assertWithinIncreaseCap(currentMinor, newMinor, MAX_INCREASE_PCT);
  assertAboveMinimum(
    newMinor,
    kind,
    kind === 'daily' ? input.minDailyBudgetMinor : input.minLifetimeBudgetMinor,
  );

  const appliedPct = pctChange(currentMinor, newMinor);

  await withAudit(
    {
      connectionId: input.connectionId,
      operationType: `${owner.ownerType}.budget.increase`,
      targetType: owner.ownerType,
      targetId: owner.ownerId,
      actorId: input.actorId ?? null,
      requestBody: {
        kind,
        previousMinor: currentMinor,
        newMinor,
        appliedPct,
        capPct: MAX_INCREASE_PCT,
        reason: input.reason,
        level: owner.level,
        campaignId: owner.campaignId,
      },
    },
    () =>
      writeBudget(
        input.connectionId,
        { type: owner.ownerType, id: owner.ownerId },
        kind,
        newMinor,
      ),
  );

  logger.info(
    {
      owner,
      kind,
      previousMinor: currentMinor,
      newMinor,
      appliedPct,
      reason: input.reason,
    },
    'Budget increased',
  );

  return {
    outcome: 'success',
    owner,
    kind,
    previousMinor: currentMinor,
    newMinor,
    appliedPct,
    reason: input.reason,
  };
}

export async function decreaseBudget(
  rawInput: DecreaseBudgetInput,
): Promise<BudgetChangeResult> {
  const input = decreaseBudgetInputSchema.parse(rawInput);
  const owner = await detectBudgetOwner(input.connectionId, input.target);

  if (owner.ownerType !== input.target.type || owner.ownerId !== input.target.id) {
    throw new BudgetTargetMismatchError(input.target, owner);
  }

  const { kind, currentMinor } = pickActiveBudget(owner);
  const newMinor = deriveTargetAmount(currentMinor, 'down', input.pct, input.newAmountMinor);

  if (newMinor >= currentMinor) {
    throw new BudgetNotDecreaseError(currentMinor, newMinor);
  }

  assertAboveMinimum(
    newMinor,
    kind,
    kind === 'daily' ? input.minDailyBudgetMinor : input.minLifetimeBudgetMinor,
  );

  const appliedPct = pctChange(currentMinor, newMinor);

  await withAudit(
    {
      connectionId: input.connectionId,
      operationType: `${owner.ownerType}.budget.decrease`,
      targetType: owner.ownerType,
      targetId: owner.ownerId,
      actorId: input.actorId ?? null,
      requestBody: {
        kind,
        previousMinor: currentMinor,
        newMinor,
        appliedPct,
        reason: input.reason,
        level: owner.level,
        campaignId: owner.campaignId,
      },
    },
    () =>
      writeBudget(
        input.connectionId,
        { type: owner.ownerType, id: owner.ownerId },
        kind,
        newMinor,
      ),
  );

  logger.info(
    {
      owner,
      kind,
      previousMinor: currentMinor,
      newMinor,
      appliedPct,
      reason: input.reason,
    },
    'Budget decreased',
  );

  return {
    outcome: 'success',
    owner,
    kind,
    previousMinor: currentMinor,
    newMinor,
    appliedPct,
    reason: input.reason,
  };
}

function pickActiveBudget(
  owner: BudgetSnapshot,
): { kind: BudgetKind; currentMinor: number } {
  if (owner.dailyBudgetMinor != null && owner.dailyBudgetMinor > 0) {
    return { kind: 'daily', currentMinor: owner.dailyBudgetMinor };
  }
  if (owner.lifetimeBudgetMinor != null && owner.lifetimeBudgetMinor > 0) {
    return { kind: 'lifetime', currentMinor: owner.lifetimeBudgetMinor };
  }
  // Detector should have prevented this, but stay defensive.
  throw new Error(
    `Owner ${owner.ownerType} ${owner.ownerId} has no active budget`,
  );
}
