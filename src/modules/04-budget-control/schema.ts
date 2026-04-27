import { z } from 'zod';

export const budgetTargetTypeSchema = z.enum(['campaign', 'adset']);
export type BudgetTargetType = z.infer<typeof budgetTargetTypeSchema>;

export const budgetTargetSchema = z.object({
  type: budgetTargetTypeSchema,
  id: z.string().min(1),
});
export type BudgetTarget = z.infer<typeof budgetTargetSchema>;

export type BudgetKind = 'daily' | 'lifetime';
export type BudgetLevel = 'cbo' | 'abo';

/** Subset of Meta status values relevant to budget operations. */
export type MetaStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';

export interface BudgetSnapshot {
  ownerType: BudgetTargetType;
  ownerId: string;
  /** Always present so callers can locate the parent campaign. */
  campaignId: string;
  level: BudgetLevel;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  status: MetaStatus;
}

const baseChange = z.object({
  connectionId: z.string().uuid(),
  target: budgetTargetSchema,
  reason: z.string().min(3, 'reason is required (audit trail)'),
  actorId: z.string().min(1).optional(),
  /** Optional ad-account-specific minimums. */
  minDailyBudgetMinor: z.number().int().positive().optional(),
  minLifetimeBudgetMinor: z.number().int().positive().optional(),
});

export const increaseBudgetInputSchema = baseChange
  .extend({
    pct: z.number().positive().max(100).optional(),
    newAmountMinor: z.number().int().positive().optional(),
  })
  .refine(
    (d) => (d.pct != null) !== (d.newAmountMinor != null),
    { message: 'specify exactly one of `pct` or `newAmountMinor`' },
  );
export type IncreaseBudgetInput = z.infer<typeof increaseBudgetInputSchema>;

export const decreaseBudgetInputSchema = baseChange
  .extend({
    pct: z.number().positive().max(99).optional(),
    newAmountMinor: z.number().int().positive().optional(),
  })
  .refine(
    (d) => (d.pct != null) !== (d.newAmountMinor != null),
    { message: 'specify exactly one of `pct` or `newAmountMinor`' },
  );
export type DecreaseBudgetInput = z.infer<typeof decreaseBudgetInputSchema>;
