import { z } from 'zod';

export const copyVariantStatusSchema = z.enum(['draft', 'approved', 'rejected']);
export type CopyVariantStatus = z.infer<typeof copyVariantStatusSchema>;

export const copyVariantStrategySchema = z.enum([
  'heuristic',
  'manual',
  'reviewed_existing',
]);
export type CopyVariantStrategy = z.infer<typeof copyVariantStrategySchema>;

export const briefFieldsSchema = z.object({
  title: z.string().min(1).max(255),
  product: z.string().max(500).optional(),
  audience: z.string().max(500).optional(),
  keyBenefits: z.array(z.string().min(1)).default([]),
  tone: z
    .enum(['professional', 'casual', 'urgent', 'inspirational', 'friendly'])
    .optional(),
  forbiddenWords: z.array(z.string().min(1)).default([]),
  targetAction: z.string().max(64).optional(),
  notes: z.string().max(2000).optional(),
});
export type BriefFields = z.infer<typeof briefFieldsSchema>;

export const createBriefInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  brief: briefFieldsSchema,
});
export type CreateBriefInput = z.infer<typeof createBriefInputSchema>;

export const updateBriefInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  briefId: z.string().uuid(),
  patch: briefFieldsSchema.partial(),
});
export type UpdateBriefInput = z.infer<typeof updateBriefInputSchema>;

export const deleteBriefInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  briefId: z.string().uuid(),
});
export type DeleteBriefInput = z.infer<typeof deleteBriefInputSchema>;

export const variantFieldsSchema = z.object({
  primaryText: z.string().min(1).max(2200),
  headline: z.string().min(1).max(255),
  description: z.string().max(255).optional(),
  cta: z.string().min(1).max(64),
  language: z.string().min(2).max(10).optional(),
});
export type VariantFields = z.infer<typeof variantFieldsSchema>;

export const generateVariantsInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  briefId: z.string().uuid(),
  /** How many heuristic variants to produce (default 3, cap 8). */
  count: z.number().int().min(1).max(8).optional(),
  language: z.string().min(2).max(10).optional(),
});
export type GenerateVariantsInput = z.infer<typeof generateVariantsInputSchema>;

export const createVariantInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  briefId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  variant: variantFieldsSchema,
});
export type CreateVariantInput = z.infer<typeof createVariantInputSchema>;

export const reviewVariantInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  variantId: z.string().uuid(),
});
export type ReviewVariantInput = z.infer<typeof reviewVariantInputSchema>;

export const reviewExternalCopyInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  briefId: z.string().uuid().optional(),
  variant: variantFieldsSchema,
  /** Persist the reviewed copy as a variant row (default true). */
  persist: z.boolean().optional(),
});
export type ReviewExternalCopyInput = z.infer<typeof reviewExternalCopyInputSchema>;

export const setStatusInputSchema = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  variantId: z.string().uuid(),
  status: z.enum(['approved', 'rejected']),
  reason: z.string().min(3).optional(),
});
export type SetStatusInput = z.infer<typeof setStatusInputSchema>;

// ---------- Review output ----------

export const dimensionScoreSchema = z.object({
  clarity: z.number().min(0).max(100),
  emotionalAppeal: z.number().min(0).max(100),
  ctaStrength: z.number().min(0).max(100),
  relevance: z.number().min(0).max(100),
  overall: z.number().min(0).max(100),
});
export type DimensionScore = z.infer<typeof dimensionScoreSchema>;

export const reviewNotesSchema = z.object({
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
  perDimension: z.array(
    z.object({
      dimension: z.string(),
      note: z.string(),
    }),
  ),
});
export type ReviewNotes = z.infer<typeof reviewNotesSchema>;

export interface ReviewResult {
  score: DimensionScore;
  notes: ReviewNotes;
}
