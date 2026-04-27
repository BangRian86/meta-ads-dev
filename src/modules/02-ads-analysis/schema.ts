import { z } from 'zod';

export const targetTypeSchema = z.enum(['campaign', 'adset', 'ad']);
export type TargetType = z.infer<typeof targetTypeSchema>;

export const dateRangeSchema = z
  .object({
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  })
  .refine((r) => r.since <= r.until, { message: 'since must be <= until' });
export type DateRange = z.infer<typeof dateRangeSchema>;

export const targetSchema = z.object({
  type: targetTypeSchema,
  id: z.string().min(1),
});
export type Target = z.infer<typeof targetSchema>;

export const performanceSummarySchema = z.object({
  spend: z.number().nonnegative(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  reach: z.number().int().nonnegative(),
  frequency: z.number().nonnegative(),
  ctr: z.number().nonnegative(),
  cpm: z.number().nonnegative(),
  cpc: z.number().nonnegative(),
  results: z.number().int().nonnegative(),
  cpr: z.number().nonnegative(),
  resultActionType: z.string().nullable(),
});
export type PerformanceSummary = z.infer<typeof performanceSummarySchema>;

export const recommendationThresholdsSchema = z.object({
  lowCtrPct: z.number().nonnegative().optional(),
  highCtrPct: z.number().nonnegative().optional(),
  significantSpend: z.number().nonnegative().optional(),
  highFrequency: z.number().nonnegative().optional(),
  zeroResultSpend: z.number().nonnegative().optional(),
});
export type RecommendationThresholdsInput = z.infer<
  typeof recommendationThresholdsSchema
>;
