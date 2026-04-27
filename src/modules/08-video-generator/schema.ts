import { z } from 'zod';

/** Subset asset type dari content_assets enum yang relevan untuk modul ini. */
export const videoAssetTypeSchema = z.enum([
  'video_generated',
  'video_image_to_video',
]);
export type VideoAssetType = z.infer<typeof videoAssetTypeSchema>;

/** Selaras dengan content_asset_status enum. */
export const videoAssetStatusSchema = z.enum([
  'pending',
  'processing',
  'success',
  'failed',
  'expired',
]);
export type VideoAssetStatus = z.infer<typeof videoAssetStatusSchema>;

export const videoResolutionSchema = z.enum(['720p', '1080p']);
export type VideoResolution = z.infer<typeof videoResolutionSchema>;

export const videoRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']);
export type VideoRatio = z.infer<typeof videoRatioSchema>;

const baseSubmit = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(5000),
  resolution: videoResolutionSchema.optional(),
  /** Wan 2.7 menerima 2-15 detik. */
  durationSec: z.number().int().min(2).max(15).optional(),
  ratio: videoRatioSchema.optional(),
  extraParams: z.record(z.unknown()).optional(),
});

export const generateVideoInputSchema = baseSubmit;
export type GenerateVideoInput = z.infer<typeof generateVideoInputSchema>;

export const imageToVideoInputSchema = baseSubmit.extend({
  /** URL gambar publik HTTPS sebagai first frame. */
  firstFrameUrl: z.string().url(),
});
export type ImageToVideoInput = z.infer<typeof imageToVideoInputSchema>;

export const pollVideoTaskInputSchema = z
  .object({
    assetId: z.string().uuid().optional(),
    providerTaskId: z.string().min(1).optional(),
  })
  .refine((d) => d.assetId != null || d.providerTaskId != null, {
    message: 'specify assetId or providerTaskId',
  });
export type PollVideoTaskInput = z.infer<typeof pollVideoTaskInputSchema>;
