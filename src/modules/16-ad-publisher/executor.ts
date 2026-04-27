import { eq } from 'drizzle-orm';
import {
  db,
  logger,
  notifyOwner,
  withAudit,
} from '../00-foundation/index.js';
import { copyVariants } from '../../db/schema/copy-variants.js';
import { metaObjectSnapshots } from '../../db/schema/meta-object-snapshots.js';
import type { PublishAdPayload } from '../12-approval-queue/index.js';
import {
  createAdFromCreative,
  createCreativeAtMeta,
  fetchSourceAd,
} from './meta-creative.js';

export interface PublishAdResult {
  ok: boolean;
  message: string;
  result?: { newAdId: string; newCreativeId: string };
}

/**
 * Materializes an approved publish_ad pending action:
 *   1. Re-fetch the variant (must still be 'approved')
 *   2. Fetch source ad's creative spec
 *   3. Build new object_story_spec with swapped text
 *   4. Create the new creative + new ad (PAUSED) in Meta
 *   5. Notify the group with the result
 *
 * Returns a structured result; caller wires this into the approval-queue
 * dispatcher which handles markExecuted/markFailed.
 */
export async function executePublishAd(
  connectionId: string,
  payload: PublishAdPayload,
): Promise<PublishAdResult> {
  const [variant] = await db
    .select()
    .from(copyVariants)
    .where(eq(copyVariants.id, payload.variantId))
    .limit(1);
  if (!variant) {
    return { ok: false, message: `Variant ${payload.variantId} hilang dari DB.` };
  }
  if (variant.status !== 'approved') {
    return {
      ok: false,
      message: `Variant ${payload.variantId} status sudah berubah → "${variant.status}". Batal publish.`,
    };
  }

  const source = await fetchSourceAd(connectionId, payload.sourceAdId);
  if (source.hasObjectStoryId && !source.objectStorySpec) {
    return {
      ok: false,
      message:
        `Source ad ${payload.sourceAdId} pakai existing post (object_story_id), ` +
        `belum support clone. Buat ad manual di Ads Manager dengan copy variant.`,
    };
  }
  if (!source.objectStorySpec) {
    return {
      ok: false,
      message: `Source ad ${payload.sourceAdId} tidak punya object_story_spec.`,
    };
  }
  if (!source.adsetId) {
    return {
      ok: false,
      message: `Source ad ${payload.sourceAdId} tidak punya adset_id.`,
    };
  }

  const newSpec = mutateObjectStorySpec(source.objectStorySpec, {
    primaryText: variant.primaryText,
    headline: variant.headline,
  });
  if (!newSpec) {
    return {
      ok: false,
      message:
        `Source creative bukan bentuk link_data sederhana — belum support. ` +
        `Buat ad manual untuk variant ${payload.variantId}.`,
    };
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const creativeName = `Publish ${variant.id.slice(0, 8)} ${stamp}`;
  const adName = `Publish v${variant.version} ${variant.headline.slice(0, 40)} - ${stamp}`;

  // Audited: each Meta call gets its own audit row so failures are visible
  // in operation_audits. Re-throw on failure so the approval-queue
  // executor sees it (markFailed handles the rest).
  const newCreative = await withAudit(
    {
      connectionId,
      operationType: 'creative.create',
      targetType: 'creative',
      actorId: 'telegram',
      requestBody: { variantId: variant.id, sourceCreativeId: source.creativeId },
    },
    () => createCreativeAtMeta(connectionId, creativeName, newSpec),
    (r) => r.id,
  );

  const newAd = await withAudit(
    {
      connectionId,
      operationType: 'ad.create',
      targetType: 'ad',
      actorId: 'telegram',
      requestBody: {
        variantId: variant.id,
        adsetId: source.adsetId,
        creativeId: newCreative.id,
        campaignId: payload.campaignId,
      },
    },
    () =>
      createAdFromCreative(connectionId, {
        name: adName,
        adsetId: source.adsetId,
        creativeId: newCreative.id,
      }),
    (r) => r.id,
  );

  // Best-effort group notification. Failures here are logged inside
  // notifyOwner so we ignore the return value.
  void notifyOwner(
    `🆕 Ad baru di-publish (PAUSED)\n` +
      `Variant: ${variant.id}\n` +
      `Campaign: ${payload.campaignId}\n` +
      `Adset: ${source.adsetId}\n` +
      `Ad ID: ${newAd.id}\n` +
      `Creative ID: ${newCreative.id}\n` +
      `Status: PAUSED — review di Ads Manager sebelum unpause.`,
  );

  // Persist a snapshot row so the next /sync isn't strictly required for
  // the new ad to appear in /status. Best-effort — if it fails, sync will
  // pick it up on next pass.
  try {
    await db.insert(metaObjectSnapshots).values({
      connectionId,
      objectType: 'ad',
      objectId: newAd.id,
      parentId: source.adsetId,
      campaignId: payload.campaignId,
      adAccountId: '', // back-filled on next sync
      name: adName,
      status: 'PAUSED',
      effectiveStatus: 'PAUSED',
      rawPayload: { source: 'publish_ad', creativeId: newCreative.id, variantId: variant.id } as never,
    });
  } catch (err) {
    logger.warn({ err, newAdId: newAd.id }, 'Could not pre-snapshot new ad — sync will catch it');
  }

  return {
    ok: true,
    message:
      `🆕 Ad PAUSED dibuat\n` +
      `Ad ID: ${newAd.id}\n` +
      `Creative ID: ${newCreative.id}\n` +
      `Adset: ${source.adsetId}\n` +
      `Review di Ads Manager sebelum unpause.`,
    result: { newAdId: newAd.id, newCreativeId: newCreative.id },
  };
}

/**
 * Returns a deep-copied object_story_spec with primaryText/headline swapped
 * into the link_data shape Meta uses for most lead/leads + traffic ads.
 * Returns null when the spec doesn't have a link_data we can mutate.
 */
function mutateObjectStorySpec(
  spec: Record<string, unknown>,
  replacements: { primaryText: string; headline: string },
): Record<string, unknown> | null {
  // Defensive deep clone — never mutate Meta's response in place.
  const cloned = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
  const linkData = cloned.link_data as Record<string, unknown> | undefined;
  if (linkData && typeof linkData === 'object') {
    linkData.message = replacements.primaryText;
    linkData.name = replacements.headline;
    return cloned;
  }
  // Some campaigns use video_data / template_data; not supported in v1.
  return null;
}
