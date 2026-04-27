import {
  logger,
  notifyOwner,
  TokenInvalidError,
} from '../00-foundation/index.js';
import { detectAndNotifyAnomalies } from '../17-anomaly-alerts/index.js';
import { evaluate } from './evaluator.js';
import { executeDecision } from './executor.js';
import {
  optimizerRunInputSchema,
  type OptimizerExecutionResult,
  type OptimizerRunInput,
} from './schema.js';

export interface RunSummary {
  evaluated: number;
  decisions: number;
  executed: number;
  notifiedOnly: number;
  skipped: number;
  failed: number;
  results: OptimizerExecutionResult[];
}

/**
 * Runs the optimizer end-to-end on a single connection. Token validation
 * happens inside every Meta-touching helper; if the token is invalid, the
 * runner aborts immediately and surfaces a single owner notification rather
 * than spamming per-campaign failure messages.
 */
export async function runOptimizer(
  rawInput: OptimizerRunInput,
): Promise<RunSummary> {
  const input = optimizerRunInputSchema.parse(rawInput);
  const { campaigns, decisions } = await evaluate(input.connectionId);

  logger.info(
    {
      connectionId: input.connectionId,
      campaigns: campaigns.length,
      decisions: decisions.length,
      kinds: countByKind(decisions),
    },
    'Optimizer evaluation complete',
  );

  // Anomaly pass — independent from decisions. Awaited so it completes
  // before the runner's caller closes the DB connection. detector has its
  // own try/catch so a failure here never aborts the optimizer pass.
  // Skipped in dryRun so previewing decisions doesn't spam alerts.
  if (!input.dryRun) {
    await detectAndNotifyAnomalies(input.connectionId);
  }

  if (decisions.length === 0) {
    return {
      evaluated: campaigns.length,
      decisions: 0,
      executed: 0,
      notifiedOnly: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };
  }

  const results: OptimizerExecutionResult[] = [];
  for (const decision of decisions) {
    if (input.dryRun) {
      results.push({
        decision,
        outcome: 'skipped',
        detail: 'dry-run mode',
      });
      continue;
    }
    try {
      const r = await executeDecision(decision, {
        connectionId: input.connectionId,
        ...(input.notifyOnly !== undefined ? { notifyOnly: input.notifyOnly } : {}),
      });
      results.push(r);
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        await notifyOwner(
          `🛑 Optimizer halted — Meta token invalid (${err.reason}). Owner must replace the token.`,
        );
        results.push({
          decision,
          outcome: 'failed',
          detail: 'TokenInvalidError — run aborted',
        });
        return tally(campaigns.length, results);
      }
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, decision }, 'Decision execution failed');
      results.push({ decision, outcome: 'failed', detail: msg });
    }
  }

  return tally(campaigns.length, results);
}

function tally(evaluated: number, results: OptimizerExecutionResult[]): RunSummary {
  const counts = { executed: 0, notifiedOnly: 0, skipped: 0, failed: 0 };
  for (const r of results) {
    if (r.outcome === 'executed') counts.executed += 1;
    else if (r.outcome === 'notified_only') counts.notifiedOnly += 1;
    else if (r.outcome === 'skipped') counts.skipped += 1;
    else counts.failed += 1;
  }
  return {
    evaluated,
    decisions: results.length,
    ...counts,
    results,
  };
}

function countByKind(decisions: { kind: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of decisions) out[d.kind] = (out[d.kind] ?? 0) + 1;
  return out;
}
