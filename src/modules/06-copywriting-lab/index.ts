export {
  copyVariantStatusSchema,
  copyVariantStrategySchema,
  briefFieldsSchema,
  variantFieldsSchema,
  createBriefInputSchema,
  updateBriefInputSchema,
  deleteBriefInputSchema,
  generateVariantsInputSchema,
  createVariantInputSchema,
  reviewVariantInputSchema,
  reviewExternalCopyInputSchema,
  setStatusInputSchema,
  dimensionScoreSchema,
  reviewNotesSchema,
  type CopyVariantStatus,
  type CopyVariantStrategy,
  type BriefFields,
  type VariantFields,
  type CreateBriefInput,
  type UpdateBriefInput,
  type DeleteBriefInput,
  type GenerateVariantsInput,
  type CreateVariantInput,
  type ReviewVariantInput,
  type ReviewExternalCopyInput,
  type SetStatusInput,
  type DimensionScore,
  type ReviewNotes,
  type ReviewResult,
} from './schema.js';

export {
  insertBrief,
  patchBrief,
  deleteBrief,
  getBrief,
  parseBrief,
  type ParsedBrief,
} from './brief-store.js';

export {
  insertVariant,
  applyReview,
  setVariantStatus,
  getVariant,
  listVariantsForBrief,
  type InsertVariantInput,
  type ApplyReviewInput,
  type SetStatusOpts,
} from './variant-store.js';

export { generateVariants } from './generator.js';

export {
  generateAiVariantsForBadAd,
  type BadAdContext,
  type GeneratedVariantBundle,
  type GenerateResult,
  type AiCopyResponse,
} from './ai-generator.js';

export { reviewVariant } from './reviewer.js';

export {
  createBrief,
  updateBrief,
  removeBrief,
  generate,
  createVariant,
  review,
  reviewExternalCopy,
  setStatus,
  listForBrief,
  type GenerationOutput,
} from './service.js';

// Copy-fix store: 3-option workflow yang dipakai optimizer +
// approval-queue. Dipindah dari 10-telegram-bot/copy-fix-store.ts
// April 2026 untuk break circular 10↔12.
export {
  approveOption,
  loadLatestDraftBatch,
  listPendingBatches,
  type DraftBatchEntry,
} from './copy-fix-store.js';
