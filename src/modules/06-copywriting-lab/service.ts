import { recordAudit } from '../../lib/audit-logger.js';
import { logger } from '../../lib/logger.js';
import {
  createBriefInputSchema,
  updateBriefInputSchema,
  deleteBriefInputSchema,
  generateVariantsInputSchema,
  createVariantInputSchema,
  reviewVariantInputSchema,
  reviewExternalCopyInputSchema,
  setStatusInputSchema,
  type CreateBriefInput,
  type UpdateBriefInput,
  type DeleteBriefInput,
  type GenerateVariantsInput,
  type CreateVariantInput,
  type ReviewVariantInput,
  type ReviewExternalCopyInput,
  type SetStatusInput,
  type ReviewResult,
} from './schema.js';
import {
  insertBrief,
  patchBrief,
  deleteBrief as deleteBriefRow,
  getBrief,
} from './brief-store.js';
import {
  insertVariant,
  applyReview,
  setVariantStatus,
  getVariant,
  listVariantsForBrief,
} from './variant-store.js';
import { generateVariants } from './generator.js';
import { reviewVariant } from './reviewer.js';
import type { CopyBrief } from '../../db/schema/copy-briefs.js';
import type { CopyVariant } from '../../db/schema/copy-variants.js';

// ---------- Briefs ----------

export async function createBrief(
  rawInput: CreateBriefInput,
): Promise<CopyBrief> {
  const input = createBriefInputSchema.parse(rawInput);
  const row = await insertBrief(input.connectionId, input.brief);
  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'copy.brief.create',
      targetType: 'copy_brief',
      targetId: row.id,
      actorId: input.actorId ?? null,
      requestBody: { title: input.brief.title },
    },
    { status: 'success', durationMs: 0 },
  );
  return row;
}

export async function updateBrief(
  rawInput: UpdateBriefInput,
): Promise<CopyBrief> {
  const input = updateBriefInputSchema.parse(rawInput);
  const row = await patchBrief(input.briefId, input.patch);
  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'copy.brief.update',
      targetType: 'copy_brief',
      targetId: input.briefId,
      actorId: input.actorId ?? null,
      requestBody: { fields: Object.keys(input.patch) },
    },
    { status: 'success', durationMs: 0 },
  );
  return row;
}

export async function removeBrief(
  rawInput: DeleteBriefInput,
): Promise<CopyBrief> {
  const input = deleteBriefInputSchema.parse(rawInput);
  const row = await deleteBriefRow(input.briefId);
  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'copy.brief.delete',
      targetType: 'copy_brief',
      targetId: input.briefId,
      actorId: input.actorId ?? null,
    },
    { status: 'success', durationMs: 0 },
  );
  return row;
}

// ---------- Variants ----------

export interface GenerationOutput {
  brief: CopyBrief;
  variants: CopyVariant[];
}

export async function generate(
  rawInput: GenerateVariantsInput,
): Promise<GenerationOutput> {
  const input = generateVariantsInputSchema.parse(rawInput);
  const brief = await getBrief(input.briefId);
  if (!brief) throw new Error(`copy_briefs row not found: ${input.briefId}`);

  const drafts = generateVariants(brief, {
    count: input.count ?? 3,
    ...(input.language !== undefined ? { language: input.language } : {}),
  });

  const inserted: CopyVariant[] = [];
  for (const v of drafts) {
    const review = reviewVariant(v, brief);
    const row = await insertVariant({
      connectionId: input.connectionId,
      briefId: brief.id,
      parentId: null,
      strategy: 'heuristic',
      variant: v,
      reviewScore: review.score,
      reviewNotes: review.notes,
      metadata: { generatedAt: new Date().toISOString() },
      createdBy: input.actorId ?? null,
    });
    inserted.push(row);
  }

  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'copy.variant.generate',
      targetType: 'copy_brief',
      targetId: brief.id,
      actorId: input.actorId ?? null,
      requestBody: { count: drafts.length, language: input.language ?? null },
    },
    {
      status: 'success',
      responseBody: { variantIds: inserted.map((r) => r.id) },
      durationMs: 0,
    },
  );

  logger.info(
    { briefId: brief.id, count: inserted.length },
    'Heuristic copy variants generated',
  );

  return { brief, variants: inserted };
}

export async function createVariant(
  rawInput: CreateVariantInput,
): Promise<CopyVariant> {
  const input = createVariantInputSchema.parse(rawInput);
  const brief = input.briefId ? await getBrief(input.briefId) : null;
  const review = reviewVariant(input.variant, brief);

  const row = await insertVariant({
    connectionId: input.connectionId,
    briefId: input.briefId ?? null,
    parentId: input.parentId ?? null,
    strategy: 'manual',
    variant: input.variant,
    reviewScore: review.score,
    reviewNotes: review.notes,
    createdBy: input.actorId ?? null,
  });

  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'copy.variant.create',
      targetType: 'copy_variant',
      targetId: row.id,
      actorId: input.actorId ?? null,
      requestBody: {
        briefId: input.briefId ?? null,
        parentId: input.parentId ?? null,
        autoReview: review.score.overall,
      },
    },
    { status: 'success', durationMs: 0 },
  );

  return row;
}

export async function review(
  rawInput: ReviewVariantInput,
): Promise<{ variant: CopyVariant; result: ReviewResult }> {
  const input = reviewVariantInputSchema.parse(rawInput);
  const variant = await getVariant(input.variantId);
  if (!variant) throw new Error(`copy_variants row not found: ${input.variantId}`);

  const brief = variant.briefId ? await getBrief(variant.briefId) : null;
  const result = reviewVariant(
    {
      primaryText: variant.primaryText,
      headline: variant.headline,
      ...(variant.description ? { description: variant.description } : {}),
      cta: variant.cta,
      ...(variant.language ? { language: variant.language } : {}),
    },
    brief,
  );

  const updated = await applyReview({
    variantId: variant.id,
    reviewScore: result.score,
    reviewNotes: result.notes,
  });

  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'copy.variant.review',
      targetType: 'copy_variant',
      targetId: variant.id,
      actorId: input.actorId ?? null,
      requestBody: { overall: result.score.overall },
    },
    { status: 'success', durationMs: 0 },
  );

  return { variant: updated, result };
}

export async function reviewExternalCopy(
  rawInput: ReviewExternalCopyInput,
): Promise<{ variant: CopyVariant | null; result: ReviewResult }> {
  const input = reviewExternalCopyInputSchema.parse(rawInput);
  const brief = input.briefId ? await getBrief(input.briefId) : null;
  const result = reviewVariant(input.variant, brief);

  if (input.persist === false) {
    return { variant: null, result };
  }

  const row = await insertVariant({
    connectionId: input.connectionId,
    briefId: input.briefId ?? null,
    parentId: null,
    strategy: 'reviewed_existing',
    variant: input.variant,
    reviewScore: result.score,
    reviewNotes: result.notes,
    createdBy: input.actorId ?? null,
  });

  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: 'copy.variant.review_external',
      targetType: 'copy_variant',
      targetId: row.id,
      actorId: input.actorId ?? null,
      requestBody: { overall: result.score.overall },
    },
    { status: 'success', durationMs: 0 },
  );

  return { variant: row, result };
}

export async function setStatus(
  rawInput: SetStatusInput,
): Promise<CopyVariant> {
  const input = setStatusInputSchema.parse(rawInput);
  const updated = await setVariantStatus({
    variantId: input.variantId,
    status: input.status,
    actorId: input.actorId ?? null,
  });

  await recordAudit(
    {
      connectionId: input.connectionId,
      operationType: input.status === 'approved' ? 'copy.variant.approve' : 'copy.variant.reject',
      targetType: 'copy_variant',
      targetId: input.variantId,
      actorId: input.actorId ?? null,
      requestBody: { status: input.status, reason: input.reason ?? null },
    },
    { status: 'success', durationMs: 0 },
  );

  return updated;
}

export async function listForBrief(briefId: string): Promise<CopyVariant[]> {
  return listVariantsForBrief(briefId);
}
