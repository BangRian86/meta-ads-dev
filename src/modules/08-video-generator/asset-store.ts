import { and, eq } from 'drizzle-orm';
import { db } from '../00-foundation/index.js';
import {
  contentAssets,
  type ContentAsset,
  type NewContentAsset,
} from '../../db/schema/content-assets.js';
import { appConfig as config } from '../00-foundation/index.js';
import type { VideoAssetStatus, VideoAssetType } from './schema.js';

export interface CreatePendingVideoAssetInput {
  connectionId: string;
  assetType: VideoAssetType;
  providerTaskId: string;
  prompt: string;
  sourceUrls?: string[];
  requestParams?: Record<string, unknown>;
}

export async function createPendingVideoAsset(
  input: CreatePendingVideoAssetInput,
): Promise<ContentAsset> {
  const values: NewContentAsset = {
    connectionId: input.connectionId,
    provider: 'kie',
    providerTaskId: input.providerTaskId,
    assetType: input.assetType,
    status: 'pending',
    prompt: input.prompt,
    sourceUrls: (input.sourceUrls ?? null) as never,
    requestParams: (input.requestParams ?? null) as never,
  };
  const [row] = await db.insert(contentAssets).values(values).returning();
  if (!row) throw new Error('Failed to insert content_assets row (video)');
  return row;
}

export async function findVideoAsset(assetId: string): Promise<ContentAsset | null> {
  const [row] = await db
    .select()
    .from(contentAssets)
    .where(eq(contentAssets.id, assetId))
    .limit(1);
  return row ?? null;
}

export async function findVideoAssetByProviderTask(
  providerTaskId: string,
): Promise<ContentAsset | null> {
  const [row] = await db
    .select()
    .from(contentAssets)
    .where(
      and(
        eq(contentAssets.provider, 'kie'),
        eq(contentAssets.providerTaskId, providerTaskId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface VideoAssetUpdate {
  status: VideoAssetStatus;
  resultUrls?: string[];
  metadata?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  expiresAt?: Date | null;
  completedAt?: Date | null;
}

export async function updateVideoAsset(
  assetId: string,
  patch: VideoAssetUpdate,
): Promise<ContentAsset> {
  const set: Partial<NewContentAsset> & { updatedAt: Date } = { updatedAt: new Date() };
  set.status = patch.status;
  if (patch.resultUrls !== undefined) set.resultUrls = patch.resultUrls as never;
  if (patch.metadata !== undefined) set.metadata = patch.metadata as never;
  if (patch.errorCode !== undefined) set.errorCode = patch.errorCode;
  if (patch.errorMessage !== undefined) set.errorMessage = patch.errorMessage;
  if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
  if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;

  const [row] = await db
    .update(contentAssets)
    .set(set)
    .where(eq(contentAssets.id, assetId))
    .returning();
  if (!row) throw new Error(`content_assets row not found: ${assetId}`);
  return row;
}

export function defaultVideoExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + config.kie.assetDefaultTtlMs);
}
