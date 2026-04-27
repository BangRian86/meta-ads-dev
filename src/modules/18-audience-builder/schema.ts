import { z } from 'zod';

// Sebelumnya inline di 11-auto-optimizer/schema.ts. Dipindah ke modul
// sendiri April 2026 untuk break circular dependency 11↔12.

export const engagementSourceTypeSchema = z.enum(['instagram', 'facebook']);
export type EngagementSourceType = z.infer<typeof engagementSourceTypeSchema>;

export const createEngagementAudienceInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  name: z.string().min(1).max(255),
  sourceType: engagementSourceTypeSchema,
  sourceId: z.string().min(1),
  retentionDays: z.union([z.literal(30), z.literal(60), z.literal(90)]),
});
export type CreateEngagementAudienceInput = z.infer<
  typeof createEngagementAudienceInputSchema
>;

export const createLookalikeInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  name: z.string().min(1).max(255),
  /** Custom audience id to seed the lookalike from. */
  originAudienceId: z.string().min(1),
  /** ISO country code (ID, US, etc.). */
  country: z.string().length(2).default('ID'),
  /** Ratios as decimals: 0.01, 0.02, 0.03 → 1%/2%/3%. */
  ratios: z.array(z.number().positive().max(0.2)).min(1).max(6),
});
export type CreateLookalikeInput = z.infer<typeof createLookalikeInputSchema>;
