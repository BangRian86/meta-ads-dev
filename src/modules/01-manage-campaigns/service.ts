import { withAudit } from '../../lib/audit-logger.js';
import {
  createCampaignInputSchema,
  createAdSetInputSchema,
  createAdInputSchema,
  syncCampaignInputSchema,
  syncObjectInputSchema,
  type CreateCampaignInput,
  type CreateAdSetInput,
  type CreateAdInput,
  type SyncCampaignInput,
  type SyncObjectInput,
} from './schema.js';
import {
  preflightCampaign,
  preflightAdSet,
  preflightAd,
  type PreflightResult,
} from './preflight.js';
import {
  createCampaignAtMeta,
  createAdSetAtMeta,
  createAdAtMeta,
} from './meta-create.js';
import { syncCampaignHierarchy, syncSingleObject } from './sync.js';
import type { MetaObjectSnapshot } from '../../db/schema/meta-object-snapshots.js';
import type { CampaignHierarchyResult } from './sync.js';

export class PreflightFailedError extends Error {
  override readonly name = 'PreflightFailedError';
  constructor(public readonly result: PreflightResult, kind: 'campaign' | 'adset' | 'ad') {
    super(
      `Preflight failed for ${kind}: missing=${result.missing.join(',') || 'none'}; ` +
        `warnings=${result.warnings.join(' | ') || 'none'}`,
    );
  }
}

export interface CreateResult<TSnap = MetaObjectSnapshot> {
  id: string;
  snapshot: TSnap;
}

export async function createCampaign(
  rawInput: CreateCampaignInput,
): Promise<CreateResult> {
  const input = createCampaignInputSchema.parse(rawInput);
  const pre = preflightCampaign(input.campaign);
  if (!pre.ok) throw new PreflightFailedError(pre, 'campaign');

  const created = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'campaign.create',
      targetType: 'campaign',
      actorId: input.actorId ?? null,
      requestBody: { fields: input.campaign, forcedStatus: 'PAUSED' },
    },
    () => createCampaignAtMeta(input.connectionId, input.campaign),
    (r) => r.id,
  );

  const snapshot = await syncSingleObject(input.connectionId, 'campaign', created.id);
  return { id: created.id, snapshot };
}

export async function createAdSet(
  rawInput: CreateAdSetInput,
): Promise<CreateResult> {
  const input = createAdSetInputSchema.parse(rawInput);
  const pre = preflightAdSet(input.adSet);
  if (!pre.ok) throw new PreflightFailedError(pre, 'adset');

  const created = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'adset.create',
      targetType: 'adset',
      actorId: input.actorId ?? null,
      requestBody: {
        fields: input.adSet,
        forcedStatus: 'PAUSED',
        campaignId: input.adSet.campaignId,
      },
    },
    () => createAdSetAtMeta(input.connectionId, input.adSet),
    (r) => r.id,
  );

  const snapshot = await syncSingleObject(input.connectionId, 'adset', created.id);
  return { id: created.id, snapshot };
}

export async function createAd(
  rawInput: CreateAdInput,
): Promise<CreateResult> {
  const input = createAdInputSchema.parse(rawInput);
  const pre = preflightAd(input.ad);
  if (!pre.ok) throw new PreflightFailedError(pre, 'ad');

  const created = await withAudit(
    {
      connectionId: input.connectionId,
      operationType: 'ad.create',
      targetType: 'ad',
      actorId: input.actorId ?? null,
      requestBody: {
        fields: input.ad,
        forcedStatus: 'PAUSED',
        adsetId: input.ad.adsetId,
      },
    },
    () => createAdAtMeta(input.connectionId, input.ad),
    (r) => r.id,
  );

  const snapshot = await syncSingleObject(input.connectionId, 'ad', created.id);
  return { id: created.id, snapshot };
}

export async function syncCampaign(
  rawInput: SyncCampaignInput,
): Promise<CampaignHierarchyResult> {
  const input = syncCampaignInputSchema.parse(rawInput);
  return syncCampaignHierarchy(input.connectionId, input.campaignId);
}

export async function syncObject(
  rawInput: SyncObjectInput,
): Promise<MetaObjectSnapshot> {
  const input = syncObjectInputSchema.parse(rawInput);
  return syncSingleObject(input.connectionId, input.type, input.id);
}
