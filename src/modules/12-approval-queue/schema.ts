import { z } from 'zod';

/**
 * Action kinds the queue can dispatch. Each kind maps to a payload type and
 * an executor branch in `executor.ts`. Add a new kind by:
 *  1. Adding the literal here
 *  2. Defining the payload type below
 *  3. Adding a case in dispatcher (executor.ts)
 *  4. Calling enqueue(...) from the relevant command/optimizer site
 */
export type ActionKind =
  | 'pause'
  | 'resume'
  | 'budget'
  | 'audience_engagement'
  | 'audience_lookalike'
  | 'copy_approve'
  | 'auto_pause'
  | 'auto_scale'
  | 'publish_ad';

export interface PausePayload {
  campaignId: string;
}
export interface ResumePayload {
  campaignId: string;
}
export interface BudgetPayload {
  /** Whether the budget lives on the campaign (CBO) or on an ad set (ABO). */
  targetType: 'campaign' | 'adset';
  /** ID of the object that actually owns the budget — campaign id for CBO,
   *  adset id for ABO. */
  targetId: string;
  newAmountMinor: number;
}
export interface AudienceEngagementPayload {
  retentionDays: 30 | 60 | 90;
  name: string;
}
export interface AudienceLookalikePayload {
  ratioPct: 1 | 2 | 3;
  sourceAudienceId: string;
  name: string;
}
export interface CopyApprovePayload {
  campaignId: string;
  optionIndex: 1 | 2 | 3;
}
export interface AutoPausePayload {
  campaignId: string;
}
export interface AutoScalePayload {
  campaignId: string;
  pct: number;
}
export interface PublishAdPayload {
  variantId: string;
  /** Snapshot of campaign id at enqueue, in case the variant metadata
   *  changes between enqueue and approve. */
  campaignId: string;
  /** Source ad whose creative shape we'll clone (adset_id + link/image
   *  reused; only text fields swapped). */
  sourceAdId: string;
}

export type ActionPayload =
  | PausePayload
  | ResumePayload
  | BudgetPayload
  | AudienceEngagementPayload
  | AudienceLookalikePayload
  | CopyApprovePayload
  | AutoPausePayload
  | AutoScalePayload
  | PublishAdPayload;

/** Display strings frozen at enqueue time so confirmation message stays
 *  readable even if upstream data shifts before approval. */
export interface ActionSummary {
  actionLabel: string;
  targetLabel: string;
  detail: string;
  reason: string;
  accountName: string;
}

export const actionKindSchema = z.enum([
  'pause',
  'resume',
  'budget',
  'audience_engagement',
  'audience_lookalike',
  'copy_approve',
  'auto_pause',
  'auto_scale',
  'publish_ad',
]);

export interface EnqueueInput {
  connectionId: string;
  actionKind: ActionKind;
  payload: ActionPayload;
  summary: ActionSummary;
  requestedBy: 'telegram' | 'auto-optimizer';
  ttlMs?: number;
}
