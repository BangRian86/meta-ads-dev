import { withAudit } from '../../lib/audit-logger.js';
import {
  generateVideoInputSchema,
  imageToVideoInputSchema,
  pollVideoTaskInputSchema,
  type GenerateVideoInput,
  type ImageToVideoInput,
  type PollVideoTaskInput,
} from './schema.js';
import { kieVideoProvider } from './kie-video-client.js';
import { createPendingVideoAsset } from './asset-store.js';
import {
  pollVideoByAssetId,
  pollVideoByProviderTask,
  type VideoPollResult,
} from './poller.js';
import type { ContentAsset } from '../../db/schema/content-assets.js';
import type { VideoProvider } from './provider.js';

export interface VideoSubmitResult {
  asset: ContentAsset;
  providerTaskId: string;
  providerLabel: string;
}

/**
 * Submit text-to-video task. Wraps provider call dengan withAudit() supaya
 * tiap submit otomatis tercatat di operation_audits.
 *
 * `provider` opsional; default ke KIE Wan 2.7. Disesuaikan dengan
 * VideoProvider abstraction supaya gampang swap.
 */
export async function submitVideoGeneration(
  rawInput: GenerateVideoInput,
  provider: VideoProvider = kieVideoProvider,
): Promise<VideoSubmitResult> {
  const input = generateVideoInputSchema.parse(rawInput);
  const requestParams = {
    prompt: input.prompt,
    resolution: input.resolution,
    durationSec: input.durationSec,
    ratio: input.ratio,
    extraParams: input.extraParams,
  };

  const submit = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'kie.video.generate',
      targetType: 'content_asset',
      actorId: input.actorId ?? null,
      requestBody: requestParams,
    },
    () =>
      provider.submit({
        mode: 'text_to_video',
        prompt: input.prompt,
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        ...(input.durationSec !== undefined ? { durationSec: input.durationSec } : {}),
        ...(input.ratio !== undefined ? { ratio: input.ratio } : {}),
        ...(input.extraParams ? { extra: input.extraParams } : {}),
      }),
    (r) => r.providerTaskId,
  );

  const asset = await createPendingVideoAsset({
    connectionId: input.connectionId,
    assetType: 'video_generated',
    providerTaskId: submit.providerTaskId,
    prompt: input.prompt,
    requestParams,
  });

  return {
    asset,
    providerTaskId: submit.providerTaskId,
    providerLabel: submit.providerLabel,
  };
}

export async function submitImageToVideo(
  rawInput: ImageToVideoInput,
  provider: VideoProvider = kieVideoProvider,
): Promise<VideoSubmitResult> {
  const input = imageToVideoInputSchema.parse(rawInput);
  const requestParams = {
    prompt: input.prompt,
    resolution: input.resolution,
    durationSec: input.durationSec,
    ratio: input.ratio,
    firstFrameUrl: input.firstFrameUrl,
    extraParams: input.extraParams,
  };

  const submit = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'kie.video.image_to_video',
      targetType: 'content_asset',
      actorId: input.actorId ?? null,
      requestBody: requestParams,
    },
    () =>
      provider.submit({
        mode: 'image_to_video',
        prompt: input.prompt,
        firstFrameUrl: input.firstFrameUrl,
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
        ...(input.durationSec !== undefined ? { durationSec: input.durationSec } : {}),
        ...(input.ratio !== undefined ? { ratio: input.ratio } : {}),
        ...(input.extraParams ? { extra: input.extraParams } : {}),
      }),
    (r) => r.providerTaskId,
  );

  const asset = await createPendingVideoAsset({
    connectionId: input.connectionId,
    assetType: 'video_image_to_video',
    providerTaskId: submit.providerTaskId,
    prompt: input.prompt,
    sourceUrls: [input.firstFrameUrl],
    requestParams,
  });

  return {
    asset,
    providerTaskId: submit.providerTaskId,
    providerLabel: submit.providerLabel,
  };
}

export async function pollVideoTask(
  rawInput: PollVideoTaskInput,
  provider: VideoProvider = kieVideoProvider,
): Promise<VideoPollResult> {
  const input = pollVideoTaskInputSchema.parse(rawInput);
  if (input.assetId) return pollVideoByAssetId(input.assetId, provider);
  if (input.providerTaskId) return pollVideoByProviderTask(input.providerTaskId, provider);
  throw new Error('pollVideoTask: assetId or providerTaskId required');
}
