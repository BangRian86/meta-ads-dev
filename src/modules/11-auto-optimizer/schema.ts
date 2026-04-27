import { z } from 'zod';

export type DecisionKind =
  | 'auto_pause'
  | 'auto_scale'
  | 'resume_notify'
  | 'cpr_alert'
  | 'copy_fix_suggestion';

export interface OptimizerDecision {
  kind: DecisionKind;
  campaignId: string;
  campaignName: string;
  reason: string;
  metrics: Record<string, number>;
}

export interface OptimizerExecutionResult {
  decision: OptimizerDecision;
  outcome: 'executed' | 'notified_only' | 'skipped' | 'failed';
  detail: string;
}

export const optimizerRunInputSchema = z.object({
  connectionId: z.string().uuid(),
  /** Set to true to evaluate but not apply any actions. */
  dryRun: z.boolean().optional(),
  /** Skip auto_pause / auto_scale executions; still send notifications. */
  notifyOnly: z.boolean().optional(),
});
export type OptimizerRunInput = z.infer<typeof optimizerRunInputSchema>;

// Audience input schemas dipindah ke `18-audience-builder/schema.ts`
// (April 2026) untuk break circular dependency 11↔12.
