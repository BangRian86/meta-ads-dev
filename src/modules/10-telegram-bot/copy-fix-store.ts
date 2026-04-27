import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  copyVariants,
  type CopyVariant,
} from '../../db/schema/copy-variants.js';

const SOURCE_TAG = 'copy_fix_suggestion';

export interface DraftBatchEntry {
  campaignId: string;
  campaignName: string;
  optimizerRunAt: string;
  variants: CopyVariant[]; // sorted by optionIndex ASC
}

/**
 * Returns the most recent batch (3 variants) for a given campaign that are
 * still in 'draft' status. Variants are sorted by optionIndex ASC.
 */
export async function loadLatestDraftBatch(
  campaignId: string,
): Promise<CopyVariant[]> {
  const rows = await db
    .select()
    .from(copyVariants)
    .where(
      and(
        eq(copyVariants.status, 'draft'),
        sql`${copyVariants.metadata}->>'source' = ${SOURCE_TAG}`,
        sql`${copyVariants.metadata}->>'campaignId' = ${campaignId}`,
      ),
    )
    .orderBy(desc(copyVariants.createdAt))
    .limit(3);

  // Sort the 3 we got by optionIndex (1, 2, 3)
  return rows.sort((a, b) => {
    const ai = readOptionIndex(a) ?? 99;
    const bi = readOptionIndex(b) ?? 99;
    return ai - bi;
  });
}

export async function approveOption(
  campaignId: string,
  optionIndex: 1 | 2 | 3,
  actorId: string,
): Promise<{ approved: CopyVariant | null; rejected: CopyVariant[] }> {
  const batch = await loadLatestDraftBatch(campaignId);
  if (batch.length === 0) {
    return { approved: null, rejected: [] };
  }
  const target = batch.find((r) => readOptionIndex(r) === optionIndex);
  if (!target) {
    return { approved: null, rejected: [] };
  }

  const rejectedRows: CopyVariant[] = [];

  await db.transaction(async (tx) => {
    await tx
      .update(copyVariants)
      .set({
        status: 'approved',
        statusChangedBy: actorId,
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(copyVariants.id, target.id));

    for (const r of batch) {
      if (r.id === target.id) continue;
      const [updated] = await tx
        .update(copyVariants)
        .set({
          status: 'rejected',
          statusChangedBy: actorId,
          statusChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(copyVariants.id, r.id))
        .returning();
      if (updated) rejectedRows.push(updated);
    }
  });

  // Re-fetch the approved row to get the latest state
  const [approved] = await db
    .select()
    .from(copyVariants)
    .where(eq(copyVariants.id, target.id))
    .limit(1);

  return { approved: approved ?? null, rejected: rejectedRows };
}

/** Lists pending draft batches, grouped by campaign, newest batch per campaign first. */
export async function listPendingBatches(limitCampaigns = 10): Promise<DraftBatchEntry[]> {
  const rows = await db
    .select()
    .from(copyVariants)
    .where(
      and(
        eq(copyVariants.status, 'draft'),
        sql`${copyVariants.metadata}->>'source' = ${SOURCE_TAG}`,
      ),
    )
    .orderBy(desc(copyVariants.createdAt))
    .limit(200);

  // Group by campaignId — keep only the most recent batch per campaign.
  const byCampaign = new Map<string, CopyVariant[]>();
  for (const r of rows) {
    const cid = readCampaignId(r);
    if (!cid) continue;
    if (!byCampaign.has(cid)) byCampaign.set(cid, []);
    const list = byCampaign.get(cid)!;
    if (list.length < 3) list.push(r);
  }

  const out: DraftBatchEntry[] = [];
  for (const [campaignId, variants] of byCampaign) {
    if (variants.length === 0) continue;
    const sorted = [...variants].sort(
      (a, b) => (readOptionIndex(a) ?? 99) - (readOptionIndex(b) ?? 99),
    );
    const first = sorted[0]!;
    out.push({
      campaignId,
      campaignName: readCampaignName(first) ?? '(unknown)',
      optimizerRunAt: readOptimizerRunAt(first) ?? first.createdAt.toISOString(),
      variants: sorted,
    });
    if (out.length >= limitCampaigns) break;
  }
  return out;
}

function metadataObj(v: CopyVariant): Record<string, unknown> | null {
  if (!v.metadata || typeof v.metadata !== 'object') return null;
  return v.metadata as Record<string, unknown>;
}

function readOptionIndex(v: CopyVariant): number | null {
  const m = metadataObj(v);
  if (!m) return null;
  const idx = m.optionIndex;
  return typeof idx === 'number' ? idx : null;
}

function readCampaignId(v: CopyVariant): string | null {
  const m = metadataObj(v);
  if (!m) return null;
  return typeof m.campaignId === 'string' ? m.campaignId : null;
}

function readCampaignName(v: CopyVariant): string | null {
  const m = metadataObj(v);
  if (!m) return null;
  return typeof m.campaignName === 'string' ? m.campaignName : null;
}

function readOptimizerRunAt(v: CopyVariant): string | null {
  const m = metadataObj(v);
  if (!m) return null;
  return typeof m.optimizerRunAt === 'string' ? m.optimizerRunAt : null;
}
