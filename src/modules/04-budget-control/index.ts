export {
  budgetTargetTypeSchema,
  budgetTargetSchema,
  increaseBudgetInputSchema,
  decreaseBudgetInputSchema,
  type BudgetTargetType,
  type BudgetTarget,
  type BudgetKind,
  type BudgetLevel,
  type BudgetSnapshot,
  type IncreaseBudgetInput,
  type DecreaseBudgetInput,
  type MetaStatus,
} from './schema.js';

export {
  readBudget,
  writeBudget,
  type BudgetReadResult,
  type BudgetWriteResult,
} from './meta-budget.js';

export {
  detectBudgetOwner,
  findFirstAdsetWithBudget,
  BudgetTargetMismatchError,
  NoBudgetConfiguredError,
  type AdsetBudgetMatch,
} from './budget-detector.js';

export {
  MAX_INCREASE_PCT,
  DEFAULT_MIN_DAILY_BUDGET_MINOR,
  DEFAULT_MIN_LIFETIME_BUDGET_MINOR,
  BudgetCapExceededError,
  BudgetBelowMinError,
  BudgetNotIncreaseError,
  BudgetNotDecreaseError,
  assertAboveMinimum,
  assertWithinIncreaseCap,
  deriveTargetAmount,
  pctChange,
} from './budget-rules.js';

export {
  increaseBudget,
  decreaseBudget,
  type BudgetChangeResult,
} from './service.js';
