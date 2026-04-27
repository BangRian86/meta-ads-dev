import { eq } from 'drizzle-orm';
import { db, logger } from '../00-foundation/index.js';
import { metaConnections } from '../../db/schema/meta-connections.js';
import { ensureKieCredentialFromEnv } from '../05-kie-image-generator/bootstrap.js';
import { submitVideoGeneration, submitImageToVideo } from './service.js';
import { pollVideoByAssetId } from './poller.js';
import { kieVideoProvider } from './kie-video-client.js';
import {
  mirrorVideoTaskFailed,
  mirrorVideoTaskPending,
  mirrorVideoTaskSucceeded,
} from './task-mirror.js';
import type { ContentAsset } from '../../db/schema/content-assets.js';
import type { VideoProvider } from './provider.js';
import type { VideoRatio, VideoResolution } from './schema.js';

export interface TelegramVideoInput {
  prompt: string;
  /** Optional context yang di-prepend ke prompt (mis. brand voice umroh). */
  contextPrefix?: string;
  /** Default 720p. */
  resolution?: VideoResolution;
  /** Default 10 detik (per requirement modul). */
  durationSec?: number;
  ratio?: VideoRatio;
  actorId: string;
}

export interface TelegramImageToVideoInput extends TelegramVideoInput {
  firstFrameUrl: string;
}

export type TelegramVideoResult =
  | {
      ok: true;
      asset: ContentAsset;
      resultUrls: string[];
      attempts: number;
      durationMs: number;
    }
  | {
      ok: false;
      reason: string;
      assetId?: string;
    };

const POLL_INTERVAL_MS = 6_000; // 6s — video gen butuh 1-3 menit, hemat call
const POLL_TIMEOUT_MS = 8 * 60_000; // 8 menit hard cap (Wan kadang lambat)

const DEFAULT_RESOLUTION: VideoResolution = '720p';
const DEFAULT_DURATION_SEC = 10;

/** Submit + wait flow untuk text-to-video. */
export async function generateVideoForTelegram(
  input: TelegramVideoInput,
  provider: VideoProvider = kieVideoProvider,
): Promise<TelegramVideoResult> {
  return runVideoFlow(
    {
      kind: 'text_to_video',
      input,
    },
    provider,
  );
}

/** Submit + wait flow untuk image-to-video (Wan I2V). */
export async function generateImageToVideoForTelegram(
  input: TelegramImageToVideoInput,
  provider: VideoProvider = kieVideoProvider,
): Promise<TelegramVideoResult> {
  return runVideoFlow(
    {
      kind: 'image_to_video',
      input,
    },
    provider,
  );
}

type FlowSpec =
  | { kind: 'text_to_video'; input: TelegramVideoInput }
  | { kind: 'image_to_video'; input: TelegramImageToVideoInput };

async function runVideoFlow(
  spec: FlowSpec,
  provider: VideoProvider,
): Promise<TelegramVideoResult> {
  const t0 = Date.now();

  const cred = await ensureKieCredentialFromEnv();
  if (!cred.credentialId) {
    return {
      ok: false,
      reason: 'KIE_API_KEY belum di-set di env. Owner perlu konfigurasi dulu.',
    };
  }

  const [conn] = await db
    .select({ id: metaConnections.id })
    .from(metaConnections)
    .where(eq(metaConnections.status, 'active'))
    .limit(1);
  if (!conn) {
    return {
      ok: false,
      reason: 'Tidak ada Meta connection aktif (dipakai sebagai audit actor).',
    };
  }

  const baseInput = spec.input;
  const finalPrompt = baseInput.contextPrefix
    ? `${baseInput.contextPrefix}\n\n${baseInput.prompt}`
    : baseInput.prompt;

  const resolution = baseInput.resolution ?? DEFAULT_RESOLUTION;
  const durationSec = baseInput.durationSec ?? DEFAULT_DURATION_SEC;

  let submitResult;
  try {
    if (spec.kind === 'text_to_video') {
      submitResult = await submitVideoGeneration(
        {
          connectionId: conn.id,
          actorId: spec.input.actorId,
          prompt: finalPrompt,
          resolution,
          durationSec,
          ...(spec.input.ratio !== undefined ? { ratio: spec.input.ratio } : {}),
        },
        provider,
      );
    } else {
      submitResult = await submitImageToVideo(
        {
          connectionId: conn.id,
          actorId: spec.input.actorId,
          prompt: finalPrompt,
          resolution,
          durationSec,
          firstFrameUrl: spec.input.firstFrameUrl,
          ...(spec.input.ratio !== undefined ? { ratio: spec.input.ratio } : {}),
        },
        provider,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'KIE video submit failed');
    return { ok: false, reason: `Submit ke KIE gagal: ${msg}` };
  }

  const taskType =
    spec.kind === 'text_to_video' ? 'video.generate' : 'video.image_to_video';
  const expiresAt = submitResult.asset.expiresAt ?? null;
  const kieTaskId = await mirrorVideoTaskPending({
    taskType,
    provider: submitResult.providerLabel,
    providerTaskId: submitResult.providerTaskId,
    prompt: finalPrompt,
    inputParams: {
      resolution,
      durationSec,
      ratio: baseInput.ratio,
      ...(spec.kind === 'image_to_video'
        ? { firstFrameUrl: spec.input.firstFrameUrl }
        : {}),
    },
    createdBy: baseInput.actorId,
    expiresAt,
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let attempts = 0;
  let lastAsset = submitResult.asset;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const polled = await pollVideoByAssetId(submitResult.asset.id, provider);
      lastAsset = polled.asset;
      if (polled.status === 'success') {
        const urls = (polled.asset.resultUrls as string[] | null) ?? [];
        if (kieTaskId) await mirrorVideoTaskSucceeded(kieTaskId, urls, null);
        return {
          ok: true,
          asset: polled.asset,
          resultUrls: urls,
          attempts,
          durationMs: Date.now() - t0,
        };
      }
      if (polled.status === 'failed') {
        const errMsg = polled.asset.errorMessage ?? 'KIE video task failed';
        if (kieTaskId) await mirrorVideoTaskFailed(kieTaskId, errMsg);
        return { ok: false, reason: errMsg, assetId: polled.asset.id };
      }
    } catch (err) {
      logger.warn({ err, assetId: submitResult.asset.id }, 'KIE video poll attempt failed');
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (kieTaskId) await mirrorVideoTaskFailed(kieTaskId, 'timeout: 8 menit terlewati');
  return {
    ok: false,
    reason: `Generate video timeout setelah ${attempts} polls (8 menit). Cek status di KIE dashboard atau retry.`,
    assetId: lastAsset.id,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
