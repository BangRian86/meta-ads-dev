import type { BudgetKind } from './schema.js';

/** Hard ceiling for a single increase operation. */
export const MAX_INCREASE_PCT = 20;

/** Conservative defaults; Meta's true minimums are per-currency / per-account. */
export const DEFAULT_MIN_DAILY_BUDGET_MINOR = 100; // e.g. $1.00 in cents
export const DEFAULT_MIN_LIFETIME_BUDGET_MINOR = 100;

export class BudgetCapExceededError extends Error {
  override readonly name = 'BudgetCapExceededError';
  constructor(
    public readonly currentMinor: number,
    public readonly requestedMinor: number,
    public readonly maxAllowedMinor: number,
    public readonly maxPct: number,
  ) {
    super(
      `Requested budget ${requestedMinor} exceeds +${maxPct}% cap. ` +
        `Current=${currentMinor}, max allowed this op=${maxAllowedMinor}.`,
    );
  }
}

export class BudgetBelowMinError extends Error {
  override readonly name = 'BudgetBelowMinError';
  constructor(
    public readonly amountMinor: number,
    public readonly minMinor: number,
    public readonly kind: BudgetKind,
  ) {
    super(
      `Budget ${amountMinor} is below ${kind} minimum ${minMinor} (minor units).`,
    );
  }
}

export class BudgetNotIncreaseError extends Error {
  override readonly name = 'BudgetNotIncreaseError';
  constructor(public readonly currentMinor: number, public readonly newMinor: number) {
    super(`New budget ${newMinor} is not greater than current ${currentMinor}.`);
  }
}

export class BudgetNotDecreaseError extends Error {
  override readonly name = 'BudgetNotDecreaseError';
  constructor(public readonly currentMinor: number, public readonly newMinor: number) {
    super(`New budget ${newMinor} is not less than current ${currentMinor}.`);
  }
}

/**
 * Returns the new amount derived from either `newAmountMinor` (absolute) or
 * `pct` applied to `currentMinor`. Floors to integer (Meta minor units).
 */
export function deriveTargetAmount(
  currentMinor: number,
  direction: 'up' | 'down',
  pct: number | undefined,
  newAmountMinor: number | undefined,
): number {
  if (newAmountMinor != null) return newAmountMinor;
  if (pct == null) {
    throw new Error('deriveTargetAmount: pct or newAmountMinor required');
  }
  const factor = direction === 'up' ? 1 + pct / 100 : 1 - pct / 100;
  return Math.floor(currentMinor * factor);
}

/**
 * Throws if the proposed increase exceeds the +MAX_INCREASE_PCT ceiling.
 * Floor of `currentMinor * 1.20`, integer-safe.
 */
export function assertWithinIncreaseCap(
  currentMinor: number,
  newMinor: number,
  maxPct: number = MAX_INCREASE_PCT,
): void {
  const maxAllowed = Math.floor(currentMinor * (1 + maxPct / 100));
  if (newMinor > maxAllowed) {
    throw new BudgetCapExceededError(currentMinor, newMinor, maxAllowed, maxPct);
  }
}

export function assertAboveMinimum(
  amountMinor: number,
  kind: BudgetKind,
  minOverride?: number,
): void {
  const min =
    minOverride ??
    (kind === 'daily'
      ? DEFAULT_MIN_DAILY_BUDGET_MINOR
      : DEFAULT_MIN_LIFETIME_BUDGET_MINOR);
  if (amountMinor < min) {
    throw new BudgetBelowMinError(amountMinor, min, kind);
  }
}

export function pctChange(currentMinor: number, newMinor: number): number {
  if (currentMinor === 0) return 0;
  return Math.round(((newMinor - currentMinor) / currentMinor) * 10000) / 100;
}
