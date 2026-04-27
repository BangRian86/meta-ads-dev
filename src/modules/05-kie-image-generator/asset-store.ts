import { and, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../00-foundation/index.js';
import {
  contentAssets,
  type ContentAsset,
  type NewContentAsset,
} from '../../db/schema/content-assets.js';
import { appConfig as config } from '../00-foundation/index.js';
import type { KieAssetStatus, KieAssetType } from './schema.js';

export interface CreatePendingAssetInput {
  connectionId: string;
  assetType: KieAssetType;
  providerTaskId: string;
  prompt: string;
  sourceUrls?: string[];
  requestParams?: Record<string, unknown>;
}

export async function createPendingAsset(
  input: CreatePendingAssetInput,
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
  if (!row) throw new Error('Failed to insert content_assets row');
  return row;
}

export async function findAsset(assetId: string): Promise<ContentAsset | null> {
  const [row] = await db
    .select()
    .from(contentAssets)
    .where(eq(contentAssets.id, assetId))
    .limit(1);
  return row ?? null;
}

export async function findAssetByProviderTask(
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

export interface AssetUpdate {
  status: KieAssetStatus;
  resultUrls?: string[];
  metadata?: Record<string, unknown> | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  expiresAt?: Date | null;
  completedAt?: Date | null;
}

export async function updateAsset(
  assetId: string,
  patch: AssetUpdate,
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

export async function listInflightAssets(
  connectionId?: string,
): Promise<ContentAsset[]> {
  const conditions = [
    eq(contentAssets.provider, 'kie'),
    inArray(contentAssets.status, ['pending', 'processing']),
  ];
  if (connectionId) {
    conditions.push(eq(contentAssets.connectionId, connectionId));
  }
  return db
    .select()
    .from(contentAssets)
    .where(and(...conditions));
}

/**
 * Sweeps assets whose recorded expiry has passed and flips them to 'expired'.
 * Returns the number of rows updated.
 */
export async function markExpiredAssets(now: Date = new Date()): Promise<number> {
  const rows = await db
    .update(contentAssets)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(contentAssets.status, 'success'),
        lt(contentAssets.expiresAt, now),
      ),
    )
    .returning({ id: contentAssets.id });
  return rows.length;
}

export function defaultExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + config.kie.assetDefaultTtlMs);
}
