import { eq } from 'drizzle-orm';
import { db } from '../00-foundation/index.js';
import {
  copyBriefs,
  type CopyBrief,
  type NewCopyBrief,
} from '../../db/schema/copy-briefs.js';
import type { BriefFields } from './schema.js';

export async function insertBrief(
  connectionId: string,
  brief: BriefFields,
): Promise<CopyBrief> {
  const values: NewCopyBrief = {
    connectionId,
    title: brief.title,
    product: brief.product ?? null,
    audience: brief.audience ?? null,
    keyBenefits: brief.keyBenefits as never,
    tone: brief.tone ?? null,
    forbiddenWords: brief.forbiddenWords as never,
    targetAction: brief.targetAction ?? null,
    notes: brief.notes ?? null,
  };
  const [row] = await db.insert(copyBriefs).values(values).returning();
  if (!row) throw new Error('Failed to insert copy_briefs row');
  return row;
}

export async function patchBrief(
  briefId: string,
  patch: Partial<BriefFields>,
): Promise<CopyBrief> {
  const set: Partial<NewCopyBrief> & { updatedAt: Date } = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.product !== undefined) set.product = patch.product;
  if (patch.audience !== undefined) set.audience = patch.audience;
  if (patch.keyBenefits !== undefined) set.keyBenefits = patch.keyBenefits as never;
  if (patch.tone !== undefined) set.tone = patch.tone;
  if (patch.forbiddenWords !== undefined) {
    set.forbiddenWords = patch.forbiddenWords as never;
  }
  if (patch.targetAction !== undefined) set.targetAction = patch.targetAction;
  if (patch.notes !== undefined) set.notes = patch.notes;

  const [row] = await db
    .update(copyBriefs)
    .set(set)
    .where(eq(copyBriefs.id, briefId))
    .returning();
  if (!row) throw new Error(`copy_briefs row not found: ${briefId}`);
  return row;
}

export async function deleteBrief(briefId: string): Promise<CopyBrief> {
  const [row] = await db
    .delete(copyBriefs)
    .where(eq(copyBriefs.id, briefId))
    .returning();
  if (!row) throw new Error(`copy_briefs row not found: ${briefId}`);
  return row;
}

export async function getBrief(briefId: string): Promise<CopyBrief | null> {
  const [row] = await db
    .select()
    .from(copyBriefs)
    .where(eq(copyBriefs.id, briefId))
    .limit(1);
  return row ?? null;
}

export interface ParsedBrief {
  brief: CopyBrief;
  keyBenefits: string[];
  forbiddenWords: string[];
}

export function parseBrief(b: CopyBrief): ParsedBrief {
  return {
    brief: b,
    keyBenefits: Array.isArray(b.keyBenefits)
      ? (b.keyBenefits as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
    forbiddenWords: Array.isArray(b.forbiddenWords)
      ? (b.forbiddenWords as unknown[]).filter((v): v is string => typeof v === 'string')
      : [],
  };
}
