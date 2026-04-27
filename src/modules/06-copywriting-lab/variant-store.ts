import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  copyVariants,
  type CopyVariant,
  type NewCopyVariant,
} from '../../db/schema/copy-variants.js';
import type {
  CopyVariantStatus,
  CopyVariantStrategy,
  DimensionScore,
  ReviewNotes,
  VariantFields,
} from './schema.js';

export interface InsertVariantInput {
  connectionId: string;
  briefId: string | null;
  parentId: string | null;
  strategy: CopyVariantStrategy;
  variant: VariantFields;
  reviewScore?: DimensionScore;
  reviewNotes?: ReviewNotes;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

export async function insertVariant(
  input: InsertVariantInput,
): Promise<CopyVariant> {
  return db.transaction(async (tx) => {
    let version = 1;
    if (input.briefId !== null) {
      const [maxRow] = await tx
        .select({ max: sql<number>`coalesce(max(${copyVariants.version}), 0)` })
        .from(copyVariants)
        .where(eq(copyVariants.briefId, input.briefId));
      version = Number(maxRow?.max ?? 0) + 1;
    }

    const values: NewCopyVariant = {
      connectionId: input.connectionId,
      briefId: input.briefId,
      parentId: input.parentId,
      version,
      strategy: input.strategy,
      primaryText: input.variant.primaryText,
      headline: input.variant.headline,
      description: input.variant.description ?? null,
      cta: input.variant.cta,
      language: input.variant.language ?? null,
      reviewScore: (input.reviewScore ?? null) as never,
      reviewNotes: (input.reviewNotes ?? null) as never,
      metadata: (input.metadata ?? null) as never,
      createdBy: input.createdBy ?? null,
    };
    const [row] = await tx.insert(copyVariants).values(values).returning();
    if (!row) throw new Error('Failed to insert copy_variants row');
    return row;
  });
}

export interface ApplyReviewInput {
  variantId: string;
  reviewScore: DimensionScore;
  reviewNotes: ReviewNotes;
}

export async function applyReview(input: ApplyReviewInput): Promise<CopyVariant> {
  const [row] = await db
    .update(copyVariants)
    .set({
      reviewScore: input.reviewScore as never,
      reviewNotes: input.reviewNotes as never,
      updatedAt: new Date(),
    })
    .where(eq(copyVariants.id, input.variantId))
    .returning();
  if (!row) throw new Error(`copy_variants row not found: ${input.variantId}`);
  return row;
}

export interface SetStatusOpts {
  variantId: string;
  status: CopyVariantStatus;
  actorId: string | null;
}

export async function setVariantStatus(
  opts: SetStatusOpts,
): Promise<CopyVariant> {
  const [row] = await db
    .update(copyVariants)
    .set({
      status: opts.status,
      statusChangedBy: opts.actorId,
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(copyVariants.id, opts.variantId))
    .returning();
  if (!row) throw new Error(`copy_variants row not found: ${opts.variantId}`);
  return row;
}

export async function getVariant(variantId: string): Promise<CopyVariant | null> {
  const [row] = await db
    .select()
    .from(copyVariants)
    .where(eq(copyVariants.id, variantId))
    .limit(1);
  return row ?? null;
}

export async function listVariantsForBrief(
  briefId: string,
): Promise<CopyVariant[]> {
  return db
    .select()
    .from(copyVariants)
    .where(eq(copyVariants.briefId, briefId))
    .orderBy(desc(copyVariants.version));
}
