export {
  optimizerRunInputSchema,
  createEngagementAudienceInputSchema,
  createLookalikeInputSchema,
  engagementSourceTypeSchema,
  type DecisionKind,
  type OptimizerDecision,
  type OptimizerExecutionResult,
  type OptimizerRunInput,
  type CreateEngagementAudienceInput,
  type CreateLookalikeInput,
  type EngagementSourceType,
} from './schema.js';

export { evaluate, type CampaignWithSummary } from './evaluator.js';
export { executeDecision, type ExecuteOpts } from './executor.js';
export {
  createEngagementAudience,
  createLookalike,
  createMultiSourceEngagementAudience,
  listMetaAudiences,
  type AudienceCreated,
  type MultiSourceEngagementInput,
  type MetaAudienceListEntry,
} from './audience-creator.js';
export { runOptimizer, type RunSummary } from './runner.js';
