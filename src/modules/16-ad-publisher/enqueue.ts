import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { copyVariants } from '../../db/schema/copy-variants.js';
import { metaConnections } from '../../db/schema/meta-connections.js';
import { metaObjectSnapshots } from '../../db/schema/meta-object-snapshots.js';
import {
  enqueue,
  type ActionPayload,
  type ActionSummary,
  type PublishAdPayload,
} from '../12-approval-queue/index.js';
import type { PendingAction } from '../../db/schema/pending-actions.js';

export interface EnqueuePublishAdInput {
  variantId: string;
  requestedBy: string;
}

export type EnqueuePublishAdResult =
  | { ok: true; pending: PendingAction }
  | { ok: false; reason: string };

/**
 * Validates an approved variant + resolves the source ad in the linked
 * campaign, then enqueues a publish_ad pending action. The actual Meta
 * writes happen later in executePublishAd via the approval queue.
 */
export async function enqueuePublishAd(
  input: EnqueuePublishAdInput,
): Promise<EnqueuePublishAdResult> {
  const [variant] = await db
    .select()
    .from(copyVariants)
    .where(eq(copyVariants.id, input.variantId))
    .limit(1);
  if (!variant) {
    return { ok: false, reason: `Variant ${input.variantId} tidak ditemukan.` };
  }
  if (variant.status !== 'approved') {
    return {
      ok: false,
      reason: `Variant ${input.variantId} status "${variant.status}", harus "approved" dulu (lihat /drafts).`,
    };
  }

  const meta = (variant.metadata ?? null) as
    | { campaignId?: string; campaignName?: string }
    | null;
  const campaignId = meta?.campaignId;
  if (!campaignId) {
    return {
      ok: false,
      reason: `Variant tidak punya campaignId di metadata (manual variant). Tidak bisa di-publish lewat /publish.`,
    };
  }

  const [conn] = await db
    .select()
    .from(metaConnections)
    .where(eq(metaConnections.id, variant.connectionId))
    .limit(1);
  if (!conn) {
    return {
      ok: false,
      reason: `Connection ${variant.connectionId} tidak ditemukan / sudah dihapus.`,
    };
  }

  // Source ad = the most-recently-snapshotted ad under this campaign. Used
  // for adset_id (so the new ad lands in the same set) + creative cloning.
  const [sourceAd] = await db
    .select()
    .from(metaObjectSnapshots)
    .where(
      and(
        eq(metaObjectSnapshots.connectionId, conn.id),
        eq(metaObjectSnapshots.objectType, 'ad'),
        eq(metaObjectSnapshots.campaignId, campaignId),
      ),
    )
    .orderBy(desc(metaObjectSnapshots.fetchedAt))
    .limit(1);
  if (!sourceAd) {
    return {
      ok: false,
      reason: `Tidak ada ad existing di campaign ${campaignId} untuk dijadikan template. /sync dulu.`,
    };
  }

  const campaignName = meta?.campaignName ?? campaignId;
  const summary: ActionSummary = {
    actionLabel: 'KONFIRMASI PUBLISH AD BARU',
    targetLabel: campaignName,
    detail: buildPreviewDetail(conn.accountName, campaignName, variant),
    reason: 'Manual publish via Telegram',
    accountName: conn.accountName,
  };

  const payload: PublishAdPayload = {
    variantId: variant.id,
    campaignId,
    sourceAdId: sourceAd.objectId,
  };

  const pending = await enqueue({
    connectionId: conn.id,
    actionKind: 'publish_ad',
    payload: payload as ActionPayload,
    summary,
    requestedBy: 'telegram',
  });
  return { ok: true, pending };
}

function buildPreviewDetail(
  accountName: string,
  campaignName: string,
  variant: typeof copyVariants.$inferSelect,
): string {
  return [
    `Campaign: ${campaignName}`,
    `Akun: ${accountName}`,
    '',
    `Primary text: ${variant.primaryText}`,
    `Headline: ${variant.headline}`,
    `CTA: ${variant.cta}`,
    '',
    'Ad akan dibuat PAUSED di Meta untuk review.',
  ].join('\n');
}
