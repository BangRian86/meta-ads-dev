import { z } from 'zod';

export const objectTypeSchema = z.enum(['campaign', 'adset', 'ad']);
export type ObjectType = z.infer<typeof objectTypeSchema>;

// ---------- Create campaign ----------

export const campaignFieldsSchema = z.object({
  name: z.string().min(1).max(400),
  objective: z.string().min(1),
  /** Required by Meta; pass [] when not housing/employment/credit/etc. */
  specialAdCategories: z.array(z.string()).default([]),
  buyingType: z.enum(['AUCTION', 'RESERVED']).optional(),
  /** Either of these makes the campaign CBO. Omit both for ABO. */
  dailyBudgetMinor: z.number().int().positive().optional(),
  lifetimeBudgetMinor: z.number().int().positive().optional(),
  bidStrategy: z.string().optional(),
});
export type CampaignFields = z.infer<typeof campaignFieldsSchema>;

export const createCampaignInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  campaign: campaignFieldsSchema,
});
export type CreateCampaignInput = z.infer<typeof createCampaignInputSchema>;

// ---------- Create ad set ----------

export const adSetFieldsSchema = z.object({
  name: z.string().min(1).max(400),
  campaignId: z.string().min(1),
  billingEvent: z.string().min(1),
  optimizationGoal: z.string().min(1),
  /** Free-form Meta targeting object. */
  targeting: z.record(z.unknown()),
  dailyBudgetMinor: z.number().int().positive().optional(),
  lifetimeBudgetMinor: z.number().int().positive().optional(),
  bidAmountMinor: z.number().int().nonnegative().optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  promotedObject: z.record(z.unknown()).optional(),
});
export type AdSetFields = z.infer<typeof adSetFieldsSchema>;

export const createAdSetInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  adSet: adSetFieldsSchema,
});
export type CreateAdSetInput = z.infer<typeof createAdSetInputSchema>;

// ---------- Create ad ----------

const inlineCreativeSchema = z.object({
  creativeId: z.string().min(1).optional(),
  creativeSpec: z.record(z.unknown()).optional(),
}).refine(
  (c) => (c.creativeId != null) !== (c.creativeSpec != null),
  { message: 'specify exactly one of creativeId or creativeSpec' },
);

export const adFieldsSchema = z.object({
  name: z.string().min(1).max(400),
  adsetId: z.string().min(1),
  creative: inlineCreativeSchema,
  trackingSpecs: z.array(z.record(z.unknown())).optional(),
});
export type AdFields = z.infer<typeof adFieldsSchema>;

export const createAdInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  ad: adFieldsSchema,
});
export type CreateAdInput = z.infer<typeof createAdInputSchema>;

// ---------- Duplicate ----------

export const duplicateInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  type: objectTypeSchema,
  sourceId: z.string().min(1),
  /** Optional rename (Meta supports prefix/suffix on copies). */
  rename: z
    .object({
      prefix: z.string().optional(),
      suffix: z.string().optional(),
    })
    .optional(),
  reason: z.string().min(3),
});
export type DuplicateInput = z.infer<typeof duplicateInputSchema>;

// ---------- Sync ----------

export const syncCampaignInputSchema = z.object({
  connectionId: z.string().uuid(),
  campaignId: z.string().min(1),
});
export type SyncCampaignInput = z.infer<typeof syncCampaignInputSchema>;

export const syncObjectInputSchema = z.object({
  connectionId: z.string().uuid(),
  type: objectTypeSchema,
  id: z.string().min(1),
});
export type SyncObjectInput = z.infer<typeof syncObjectInputSchema>;
