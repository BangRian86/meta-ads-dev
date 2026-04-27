export {
  optimizerRunInputSchema,
  type DecisionKind,
  type OptimizerDecision,
  type OptimizerExecutionResult,
  type OptimizerRunInput,
} from './schema.js';

export { evaluate, type CampaignWithSummary } from './evaluator.js';
export { executeDecision, type ExecuteOpts } from './executor.js';
export { runOptimizer, type RunSummary } from './runner.js';
