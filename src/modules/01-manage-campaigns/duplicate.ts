import { recordAudit, withAudit } from '../00-foundation/index.js';
import { logger } from '../00-foundation/index.js';
import {
  copyObjectAtMeta,
  deleteObjectAtMeta,
} from './meta-create.js';
import { syncCampaignHierarchy, syncSingleObject } from './sync.js';
import type { CampaignHierarchyResult } from './sync.js';
import type { MetaObjectSnapshot } from '../../db/schema/meta-object-snapshots.js';
import {
  duplicateInputSchema,
  type DuplicateInput,
  type ObjectType,
} from './schema.js';

interface RollbackStep {
  desc: string;
  fn: () => Promise<void>;
}

export interface DuplicateResult {
  newId: string;
  type: ObjectType;
  campaignSnapshot?: MetaObjectSnapshot;
  hierarchy?: CampaignHierarchyResult;
  singleSnapshot?: MetaObjectSnapshot;
}

/**
 * Duplicates a Meta object using `/copies` (atomic at Meta side, deep_copy
 * for campaign/adset). Children inherit `status_option=PAUSED` so nothing
 * starts delivering. Post-copy hierarchy sync is wrapped in a rollback stack:
 * if sync fails, we delete the duplicate so the operator does not end up with
 * an orphan they didn't sign off on.
 */
export async function duplicateObject(
  rawInput: DuplicateInput,
): Promise<DuplicateResult> {
  const input = duplicateInputSchema.parse(rawInput);
  const rollback: RollbackStep[] = [];
  const operationType = `${input.type}.duplicate`;
  const auditCtx = {
    connectionId: input.connectionId,
    operationType,
    targetType: input.type,
    targetId: input.sourceId,
    actorId: input.actorId ?? null,
    requestBody: {
      sourceId: input.sourceId,
      reason: input.reason,
      rename: input.rename ?? null,
    },
  } as const;

  try {
    const copy = await withAudit(
      auditCtx,
      () =>
        copyObjectAtMeta(input.connectionId, input.type, input.sourceId, {
          rename: input.rename,
        }),
      (r) => r.id,
    );
    rollback.push({
      desc: `delete duplicated ${input.type} ${copy.id}`,
      fn: () => deleteObjectAtMeta(input.connectionId, copy.id).then(() => undefined),
    });

    if (input.type === 'campaign') {
      const hierarchy = await syncCampaignHierarchy(input.connectionId, copy.id);
      return {
        newId: copy.id,
        type: input.type,
        campaignSnapshot: hierarchy.campaign,
        hierarchy,
      };
    }

    if (input.type === 'adset') {
      const adSetSnap = await syncSingleObject(input.connectionId, 'adset', copy.id);
      const childAds = adSetSnap.campaignId
        ? await syncCampaignHierarchy(input.connectionId, adSetSnap.campaignId)
        : undefined;
      return {
        newId: copy.id,
        type: input.type,
        singleSnapshot: adSetSnap,
        ...(childAds ? { hierarchy: childAds } : {}),
      };
    }

    // ad
    const adSnap = await syncSingleObject(input.connectionId, 'ad', copy.id);
    return { newId: copy.id, type: input.type, singleSnapshot: adSnap };
  } catch (err) {
    logger.warn(
      { err, sourceId: input.sourceId, type: input.type, rollbackSteps: rollback.length },
      'Duplicate failed — running rollback',
    );

    const rollbackResults: Array<{ desc: string; ok: boolean; error?: string }> = [];
    for (const step of rollback.reverse()) {
      try {
        await step.fn();
        rollbackResults.push({ desc: step.desc, ok: true });
        logger.info({ desc: step.desc }, 'Rollback step succeeded');
      } catch (e) {
        rollbackResults.push({
          desc: step.desc,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
        logger.error({ err: e, desc: step.desc }, 'Rollback step FAILED — manual cleanup required');
      }
    }

    await recordAudit(
      {
        connectionId: input.connectionId,
        operationType: `${input.type}.duplicate.rollback`,
        targetType: input.type,
        targetId: input.sourceId,
        actorId: input.actorId ?? null,
        requestBody: { reason: input.reason },
      },
      {
        status: 'failed',
        errorCode: 'duplicate_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        responseBody: { rollback: rollbackResults },
        durationMs: 0,
      },
    );

    throw err;
  }
}
