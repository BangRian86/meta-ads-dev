import { logger } from '../00-foundation/index.js';
import { recordAudit } from '../00-foundation/index.js';
import { kieCallbackPayloadSchema, type KieCallbackPayload } from './schema.js';
import {
  defaultExpiry,
  findAssetByProviderTask,
  updateAsset,
} from './asset-store.js';
import { pluckResultUrls } from './kie-client.js';
import type { ContentAsset } from '../../db/schema/content-assets.js';

export interface CallbackOutcome {
  outcome: 'updated' | 'unknown_task' | 'noop';
  assetId?: string;
  asset?: ContentAsset;
  detail: string;
}

/**
 * Processes a KIE callback POST body. Returns an outcome the HTTP handler can
 * use to choose a response code (e.g. 200 for updated/noop, 404 for unknown).
 *
 * Idempotent: if the asset is already terminal, no-ops without erroring.
 */
export async function processCallback(rawPayload: unknown): Promise<CallbackOutcome> {
  const parsed = kieCallbackPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'Rejected malformed KIE callback');
    return { outcome: 'noop', detail: 'invalid payload shape' };
  }

  const payload: KieCallbackPayload = parsed.data;
  const taskId = payload.data.taskId;
  const asset = await findAssetByProviderTask(taskId);
  if (!asset) {
    logger.warn({ taskId }, 'Callback received for unknown KIE task');
    return { outcome: 'unknown_task', detail: `no asset row for task ${taskId}` };
  }

  if (asset.status === 'success' || asset.status === 'failed' || asset.status === 'expired') {
    return {
      outcome: 'noop',
      assetId: asset.id,
      asset,
      detail: `asset already terminal (${asset.status})`,
    };
  }

  const code = payload.code ?? 200;
  const isSuccess = code === 200 && (payload.data.status ?? '').toUpperCase() !== 'GENERATE_FAILED';

  if (isSuccess) {
    const resultUrls = pluckResultUrls(payload.data as Record<string, unknown>);
    const updated = await updateAsset(asset.id, {
      status: 'success',
      resultUrls,
      metadata: { rawCallback: payload },
      expiresAt: defaultExpiry(),
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    });
    await recordAudit(
      {
        connectionId: asset.connectionId,
        operationType: 'kie.callback.success',
        targetType: 'content_asset',
        targetId: asset.id,
        requestBody: { providerTaskId: taskId },
      },
      {
        status: 'success',
        responseBody: { resultUrls },
        durationMs: 0,
      },
    );
    return { outcome: 'updated', assetId: asset.id, asset: updated, detail: 'success' };
  }

  const errorMessage = payload.data.errorMsg ?? payload.msg ?? 'KIE reported failure';
  const updated = await updateAsset(asset.id, {
    status: 'failed',
    errorCode: `kie_${code}`,
    errorMessage,
    metadata: { rawCallback: payload },
    completedAt: new Date(),
  });
  await recordAudit(
    {
      connectionId: asset.connectionId,
      operationType: 'kie.callback.failed',
      targetType: 'content_asset',
      targetId: asset.id,
      requestBody: { providerTaskId: taskId },
    },
    {
      status: 'failed',
      errorCode: `kie_${code}`,
      errorMessage,
      durationMs: 0,
    },
  );
  return { outcome: 'updated', assetId: asset.id, asset: updated, detail: 'failed' };
}
