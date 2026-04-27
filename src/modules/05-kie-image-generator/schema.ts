import { z } from 'zod';

export const kieAssetTypeSchema = z.enum(['image_generated', 'image_edited']);
export type KieAssetType = z.infer<typeof kieAssetTypeSchema>;

export const kieAssetStatusSchema = z.enum([
  'pending',
  'processing',
  'success',
  'failed',
  'expired',
]);
export type KieAssetStatus = z.infer<typeof kieAssetStatusSchema>;

/** Sizes accepted by KIE 4o-image generation. Loose-string fallback for new sizes. */
export const kieSizeSchema = z.union([
  z.enum(['1:1', '3:2', '2:3', '16:9', '9:16']),
  z.string().regex(/^\d+:\d+$/),
]);
export type KieSize = z.infer<typeof kieSizeSchema>;

const baseSubmit = z.object({
  connectionId: z.string().uuid(),
  actorId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(4000),
  size: kieSizeSchema.optional(),
  nVariants: z.number().int().min(1).max(4).optional(),
  isEnhance: z.boolean().optional(),
  /** Forward arbitrary KIE options (e.g. uploadCn, etc.). */
  extraParams: z.record(z.unknown()).optional(),
});

export const generateImageInputSchema = baseSubmit;
export type GenerateImageInput = z.infer<typeof generateImageInputSchema>;

export const editImageInputSchema = baseSubmit.extend({
  sourceUrls: z.array(z.string().url()).min(1).max(10),
});
export type EditImageInput = z.infer<typeof editImageInputSchema>;

export const pollTaskInputSchema = z.object({
  connectionId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  providerTaskId: z.string().min(1).optional(),
}).refine(
  (d) => d.assetId != null || d.providerTaskId != null,
  { message: 'specify assetId or providerTaskId' },
);
export type PollTaskInput = z.infer<typeof pollTaskInputSchema>;

/** Shape KIE POSTs to our callback URL. We treat all fields as optional and
 *  validate defensively. */
export const kieCallbackPayloadSchema = z.object({
  code: z.number().optional(),
  msg: z.string().optional(),
  data: z
    .object({
      taskId: z.string().min(1),
      info: z
        .object({
          resultUrls: z.array(z.string().url()).optional(),
        })
        .optional(),
      response: z
        .object({
          resultUrls: z.array(z.string().url()).optional(),
        })
        .optional(),
      status: z.string().optional(),
      errorMsg: z.string().optional(),
    })
    .passthrough(),
});
export type KieCallbackPayload = z.infer<typeof kieCallbackPayloadSchema>;
