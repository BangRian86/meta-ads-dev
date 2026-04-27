import { logger } from '../00-foundation/index.js';
import { recordAudit } from '../00-foundation/index.js';
import { fetchTaskDetail, type KieTaskStatus } from './kie-client.js';
import {
  defaultExpiry,
  findAsset,
  findAssetByProviderTask,
  listInflightAssets,
  updateAsset,
} from './asset-store.js';
import { appConfig as config } from '../00-foundation/index.js';
import type { ContentAsset } from '../../db/schema/content-assets.js';
import type { KieAssetStatus } from './schema.js';

export interface PollResult {
  asset: ContentAsset;
  changed: boolean;
  status: KieAssetStatus;
}

/**
 * One-shot poll. Fetches latest detail from KIE and reconciles the DB row.
 * Idempotent — safe to call repeatedly.
 */
export async function pollAsset(asset: ContentAsset): Promise<PollResult> {
  const detail = await fetchTaskDetail(asset.connectionId, asset.providerTaskId);
  const newStatus: KieAssetStatus = mapStatus(detail.status);

  if (newStatus === asset.status && newStatus !== 'success') {
    return { asset, changed: false, status: newStatus };
  }

  if (newStatus === 'success') {
    const updated = await updateAsset(asset.id, {
      status: 'success',
      resultUrls: detail.resultUrls,
      metadata: { rawDetail: detail.raw },
      completedAt: new Date(),
      expiresAt: defaultExpiry(),
      errorCode: null,
      errorMessage: null,
    });
    await recordAudit(
      {
        connectionId: asset.connectionId,
        operationType: 'kie.task.completed',
        targetType: 'content_asset',
        targetId: asset.id,
        requestBody: { providerTaskId: asset.providerTaskId },
      },
      {
        status: 'success',
        responseBody: { resultUrls: detail.resultUrls },
        durationMs: 0,
      },
    );
    return { asset: updated, changed: true, status: 'success' };
  }

  if (newStatus === 'failed') {
    const updated = await updateAsset(asset.id, {
      status: 'failed',
      errorCode: 'kie_failed',
      errorMessage: detail.errorMessage ?? 'KIE reported failure',
      metadata: { rawDetail: detail.raw },
      completedAt: new Date(),
    });
    await recordAudit(
      {
        connectionId: asset.connectionId,
        operationType: 'kie.task.failed',
        targetType: 'content_asset',
        targetId: asset.id,
        requestBody: { providerTaskId: asset.providerTaskId },
      },
      {
        status: 'failed',
        errorCode: 'kie_failed',
        errorMessage: detail.errorMessage ?? null,
        durationMs: 0,
      },
    );
    return { asset: updated, changed: true, status: 'failed' };
  }

  // processing / pending — only update if status changed (e.g. pending → processing)
  if (newStatus !== asset.status) {
    const updated = await updateAsset(asset.id, { status: newStatus });
    return { asset: updated, changed: true, status: newStatus };
  }
  return { asset, changed: false, status: newStatus };
}

export async function pollByAssetId(assetId: string): Promise<PollResult> {
  const asset = await findAsset(assetId);
  if (!asset) throw new Error(`content_assets row not found: ${assetId}`);
  return pollAsset(asset);
}

export async function pollByProviderTask(providerTaskId: string): Promise<PollResult> {
  const asset = await findAssetByProviderTask(providerTaskId);
  if (!asset) {
    throw new Error(`No content_assets row for KIE taskId=${providerTaskId}`);
  }
  return pollAsset(asset);
}

export interface BatchPollResult {
  scanned: number;
  changed: number;
  failures: Array<{ assetId: string; error: string }>;
}

/**
 * Sweeps all in-flight (pending/processing) KIE assets and polls each. Failures
 * on individual rows are logged and counted; the batch continues.
 */
export async function pollAllInflight(connectionId?: string): Promise<BatchPollResult> {
  const assets = await listInflightAssets(connectionId);
  let changed = 0;
  const failures: BatchPollResult['failures'] = [];
  for (const a of assets) {
    try {
      const r = await pollAsset(a);
      if (r.changed) changed += 1;
    } catch (err) {
      failures.push({
        assetId: a.id,
        error: err instanceof Error ? err.message : String(err),
      });
      logger.warn({ err, assetId: a.id }, 'Polling asset failed');
    }
  }
  logger.info(
    { scanned: assets.length, changed, failureCount: failures.length, intervalMs: config.kie.pollIntervalMs },
    'KIE batch poll complete',
  );
  return { scanned: assets.length, changed, failures };
}

function mapStatus(s: KieTaskStatus): KieAssetStatus {
  // KIE statuses already align 1:1 except 'pending'/'processing' which we accept as-is
  return s;
}
