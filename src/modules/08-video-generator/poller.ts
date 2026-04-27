import { logger } from '../../lib/logger.js';
import { recordAudit } from '../../lib/audit-logger.js';
import {
  defaultVideoExpiry,
  findVideoAsset,
  findVideoAssetByProviderTask,
  updateVideoAsset,
} from './asset-store.js';
import { downloadAllToLocal } from './download.js';
import type { VideoAssetStatus } from './schema.js';
import type { ContentAsset } from '../../db/schema/content-assets.js';
import type { VideoProvider, VideoTaskStatus } from './provider.js';

export interface VideoPollResult {
  asset: ContentAsset;
  changed: boolean;
  status: VideoAssetStatus;
}

/**
 * One-shot poll. Idempotent — safe to call repeatedly.
 *
 * Provider di-inject, bukan di-import langsung supaya kalau nanti tukar
 * ke non-KIE provider, poller logic-nya tetap reusable.
 */
export async function pollVideoAsset(
  asset: ContentAsset,
  provider: VideoProvider,
): Promise<VideoPollResult> {
  const detail = await provider.fetchDetail(asset.providerTaskId);
  const newStatus = mapStatus(detail.status);

  if (newStatus === asset.status && newStatus !== 'success') {
    return { asset, changed: false, status: newStatus };
  }

  if (newStatus === 'success') {
    // Download ke disk supaya URL provider yang expire cepat (KIE
    // tempfile bertahan beberapa jam) tidak bikin asset jadi unusable
    // setelah TTL `content_assets.expiresAt`. Best-effort: kalau download
    // gagal, fall back ke URL asal supaya flow tidak break.
    let storedUrls: string[] = detail.resultUrls;
    let downloadedBytes = 0;
    let downloadError: string | null = null;
    try {
      const downloads = await downloadAllToLocal(detail.resultUrls, asset.id);
      storedUrls = downloads.map((d) => d.localPath);
      downloadedBytes = downloads.reduce((sum, d) => sum + d.bytes, 0);
    } catch (err) {
      downloadError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, assetId: asset.id, urls: detail.resultUrls },
        'Local video download failed — keeping provider URL',
      );
    }

    const updated = await updateVideoAsset(asset.id, {
      status: 'success',
      resultUrls: storedUrls,
      metadata: {
        rawDetail: detail.raw,
        originalUrls: detail.resultUrls,
        downloadedBytes,
        ...(downloadError ? { downloadError } : {}),
      },
      completedAt: new Date(),
      expiresAt: defaultVideoExpiry(),
      errorCode: null,
      errorMessage: null,
    });
    await recordAudit(
      {
        connectionId: asset.connectionId,
        operationType: 'kie.video.completed',
        targetType: 'content_asset',
        targetId: asset.id,
        requestBody: { providerTaskId: asset.providerTaskId },
      },
      {
        status: 'success',
        responseBody: {
          resultUrls: storedUrls,
          originalUrls: detail.resultUrls,
          downloadedBytes,
          ...(downloadError ? { downloadError } : {}),
        },
        durationMs: 0,
      },
    );
    return { asset: updated, changed: true, status: 'success' };
  }

  if (newStatus === 'failed') {
    const updated = await updateVideoAsset(asset.id, {
      status: 'failed',
      errorCode: 'kie_failed',
      errorMessage: detail.errorMessage ?? 'KIE video task failed',
      metadata: { rawDetail: detail.raw },
      completedAt: new Date(),
    });
    await recordAudit(
      {
        connectionId: asset.connectionId,
        operationType: 'kie.video.failed',
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

  if (newStatus !== asset.status) {
    const updated = await updateVideoAsset(asset.id, { status: newStatus });
    return { asset: updated, changed: true, status: newStatus };
  }
  return { asset, changed: false, status: newStatus };
}

export async function pollVideoByAssetId(
  assetId: string,
  provider: VideoProvider,
): Promise<VideoPollResult> {
  const asset = await findVideoAsset(assetId);
  if (!asset) throw new Error(`content_assets row not found: ${assetId}`);
  return pollVideoAsset(asset, provider);
}

export async function pollVideoByProviderTask(
  providerTaskId: string,
  provider: VideoProvider,
): Promise<VideoPollResult> {
  const asset = await findVideoAssetByProviderTask(providerTaskId);
  if (!asset) {
    throw new Error(`No content_assets row for provider taskId=${providerTaskId}`);
  }
  return pollVideoAsset(asset, provider);
}

function mapStatus(s: VideoTaskStatus): VideoAssetStatus {
  // 1:1 — 'pending'/'processing' map straight; 'success'/'failed' too.
  return s;
}
