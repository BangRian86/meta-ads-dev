import { z } from 'zod';

export const objectTypeSchema = z.enum(['campaign', 'adset', 'ad']);
export type ObjectType = z.infer<typeof objectTypeSchema>;

export const objectRefSchema = z.object({
  type: objectTypeSchema,
  id: z.string().min(1),
});
export type ObjectRef = z.infer<typeof objectRefSchema>;

export const statusChangeInputSchema = z.object({
  connectionId: z.string().uuid(),
  target: objectRefSchema,
  actorId: z.string().min(1).optional(),
});
export type StatusChangeInput = z.infer<typeof statusChangeInputSchema>;

export const META_STATUSES = ['ACTIVE', 'PAUSED', 'DELETED', 'ARCHIVED'] as const;
export type MetaStatus = (typeof META_STATUSES)[number];

/** Kept narrow on purpose; effective_status has many values, we only treat known
 *  blockers explicitly and pass the rest through. */
export type MetaEffectiveStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'DELETED'
  | 'ARCHIVED'
  | 'PENDING_REVIEW'
  | 'DISAPPROVED'
  | 'PREAPPROVED'
  | 'PENDING_BILLING_INFO'
  | 'CAMPAIGN_PAUSED'
  | 'ADSET_PAUSED'
  | 'IN_PROCESS'
  | 'WITH_ISSUES'
  | (string & {}); // allow unknown forward-compat values
