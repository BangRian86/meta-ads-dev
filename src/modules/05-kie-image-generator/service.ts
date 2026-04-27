import { appConfig as config } from '../00-foundation/index.js';
import { withAudit } from '../00-foundation/index.js';
import {
  generateImageInputSchema,
  editImageInputSchema,
  pollTaskInputSchema,
  type GenerateImageInput,
  type EditImageInput,
  type PollTaskInput,
} from './schema.js';
import { submitImageTask } from './kie-client.js';
import { createPendingAsset } from './asset-store.js';
import {
  pollByAssetId,
  pollByProviderTask,
  type PollResult,
} from './poller.js';
import type { ContentAsset } from '../../db/schema/content-assets.js';

export interface SubmitResult {
  asset: ContentAsset;
  providerTaskId: string;
}

export async function submitGeneration(
  rawInput: GenerateImageInput,
): Promise<SubmitResult> {
  const input = generateImageInputSchema.parse(rawInput);
  const requestParams = {
    prompt: input.prompt,
    size: input.size,
    nVariants: input.nVariants,
    isEnhance: input.isEnhance,
    extraParams: input.extraParams,
  };

  const submit = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'kie.image.generate',
      targetType: 'content_asset',
      actorId: input.actorId ?? null,
      requestBody: requestParams,
    },
    () =>
      submitImageTask(input.connectionId, {
        prompt: input.prompt,
        ...(input.size !== undefined ? { size: input.size } : {}),
        ...(input.nVariants !== undefined ? { nVariants: input.nVariants } : {}),
        ...(input.isEnhance !== undefined ? { isEnhance: input.isEnhance } : {}),
        ...(config.kie.callbackUrl ? { callBackUrl: config.kie.callbackUrl } : {}),
        ...(input.extraParams ? { extra: input.extraParams } : {}),
      }),
    (r) => r.taskId,
  );

  const asset = await createPendingAsset({
    connectionId: input.connectionId,
    assetType: 'image_generated',
    providerTaskId: submit.taskId,
    prompt: input.prompt,
    requestParams,
  });

  return { asset, providerTaskId: submit.taskId };
}

export async function submitEdit(rawInput: EditImageInput): Promise<SubmitResult> {
  const input = editImageInputSchema.parse(rawInput);
  const requestParams = {
    prompt: input.prompt,
    size: input.size,
    nVariants: input.nVariants,
    isEnhance: input.isEnhance,
    sourceUrls: input.sourceUrls,
    extraParams: input.extraParams,
  };

  const submit = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'kie.image.edit',
      targetType: 'content_asset',
      actorId: input.actorId ?? null,
      requestBody: requestParams,
    },
    () =>
      submitImageTask(input.connectionId, {
        prompt: input.prompt,
        filesUrl: input.sourceUrls,
        ...(input.size !== undefined ? { size: input.size } : {}),
        ...(input.nVariants !== undefined ? { nVariants: input.nVariants } : {}),
        ...(input.isEnhance !== undefined ? { isEnhance: input.isEnhance } : {}),
        ...(config.kie.callbackUrl ? { callBackUrl: config.kie.callbackUrl } : {}),
        ...(input.extraParams ? { extra: input.extraParams } : {}),
      }),
    (r) => r.taskId,
  );

  const asset = await createPendingAsset({
    connectionId: input.connectionId,
    assetType: 'image_edited',
    providerTaskId: submit.taskId,
    prompt: input.prompt,
    sourceUrls: input.sourceUrls,
    requestParams,
  });

  return { asset, providerTaskId: submit.taskId };
}

export async function pollTask(rawInput: PollTaskInput): Promise<PollResult> {
  const input = pollTaskInputSchema.parse(rawInput);
  if (input.assetId) return pollByAssetId(input.assetId);
  if (input.providerTaskId) return pollByProviderTask(input.providerTaskId);
  throw new Error('pollTask: assetId or providerTaskId required');
}
