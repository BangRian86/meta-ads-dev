import { logger } from '../../lib/logger.js';
import {
  fetchObject,
  listAccountCampaigns,
  listChildren,
  MetaApiError,
} from './meta-read.js';
import { saveObjectSnapshot } from './snapshot-store.js';
import type { MetaObjectSnapshot } from '../../db/schema/meta-object-snapshots.js';
import type { ObjectType } from './schema.js';

export interface CampaignHierarchyResult {
  campaign: MetaObjectSnapshot;
  adSets: MetaObjectSnapshot[];
  ads: MetaObjectSnapshot[];
}

/**
 * Walks campaign → adsets → ads from Meta and persists a fresh snapshot for
 * every object encountered. All reads go through meta_request_logs; all
 * persisted state is queryable from meta_object_snapshots afterwards.
 */
export async function syncCampaignHierarchy(
  connectionId: string,
  campaignId: string,
): Promise<CampaignHierarchyResult> {
  const campaignRead = await fetchObject(connectionId, 'campaign', campaignId);
  const campaignSnapshot = await saveObjectSnapshot(connectionId, campaignRead);

  const adSetReads = await listChildren(connectionId, 'campaign', campaignId);
  const adSetSnapshots: MetaObjectSnapshot[] = [];
  for (const a of adSetReads) {
    adSetSnapshots.push(await saveObjectSnapshot(connectionId, a));
  }

  const adSnapshots: MetaObjectSnapshot[] = [];
  for (const adSet of adSetReads) {
    const adReads = await listChildren(connectionId, 'adset', adSet.id);
    for (const ad of adReads) {
      adSnapshots.push(await saveObjectSnapshot(connectionId, ad));
    }
  }

  logger.info(
    {
      campaignId,
      adSets: adSetSnapshots.length,
      ads: adSnapshots.length,
    },
    'Campaign hierarchy synced',
  );

  return { campaign: campaignSnapshot, adSets: adSetSnapshots, ads: adSnapshots };
}

/**
 * Single-object sync. For adset/ad targets the hierarchy walk above is
 * preferred — this is for cases where the parent context is already known.
 */
export async function syncSingleObject(
  connectionId: string,
  type: ObjectType,
  id: string,
): Promise<MetaObjectSnapshot> {
  const read = await fetchObject(connectionId, type, id);
  return saveObjectSnapshot(connectionId, read);
}

export interface AccountSyncResult {
  campaignCount: number;
  adSetCount: number;
  adCount: number;
  rateLimitedCampaigns: Array<{ id: string; name: string; phase: 'adsets' | 'ads' }>;
  campaigns: CampaignHierarchyResult[];
}

/**
 * Account-wide sync. Lists every campaign under the connection's ad account,
 * persists each one (re-using the list payload — no extra GET per campaign),
 * then walks adsets and ads. Counts are returned for caller logging.
 *
 * Rate-limit handling: if Meta returns code 17 / kind=`rate_limit` while
 * walking a campaign's children, that campaign is skipped (with the campaign
 * snapshot still saved, since we got it from listAccountCampaigns) and the
 * loop continues to the next campaign. Skips are tallied in the result so the
 * caller can decide whether to backfill later.
 */
export async function syncAccount(connectionId: string): Promise<AccountSyncResult> {
  const campaignReads = await listAccountCampaigns(connectionId);
  logger.info(
    { connectionId, campaignsFound: campaignReads.length },
    'Account campaign list fetched',
  );

  const results: CampaignHierarchyResult[] = [];
  const rateLimitedCampaigns: AccountSyncResult['rateLimitedCampaigns'] = [];
  let adSetCount = 0;
  let adCount = 0;

  for (const c of campaignReads) {
    const campaignSnap = await saveObjectSnapshot(connectionId, c);

    let adSetReads: Awaited<ReturnType<typeof listChildren>>;
    try {
      adSetReads = await listChildren(connectionId, 'campaign', c.id);
    } catch (err) {
      if (err instanceof MetaApiError && err.mapped.kind === 'rate_limit') {
        logger.warn(
          { campaignId: c.id, name: c.name, code: err.mapped.code },
          'Rate-limited listing adsets — skipping campaign',
        );
        rateLimitedCampaigns.push({ id: c.id, name: c.name, phase: 'adsets' });
        results.push({ campaign: campaignSnap, adSets: [], ads: [] });
        continue;
      }
      throw err;
    }

    const adSetSnaps: MetaObjectSnapshot[] = [];
    for (const a of adSetReads) {
      adSetSnaps.push(await saveObjectSnapshot(connectionId, a));
    }

    const adSnaps: MetaObjectSnapshot[] = [];
    let adsRateLimited = false;
    for (const adSet of adSetReads) {
      try {
        const adReads = await listChildren(connectionId, 'adset', adSet.id);
        for (const ad of adReads) {
          adSnaps.push(await saveObjectSnapshot(connectionId, ad));
        }
      } catch (err) {
        if (err instanceof MetaApiError && err.mapped.kind === 'rate_limit') {
          logger.warn(
            { campaignId: c.id, adsetId: adSet.id, code: err.mapped.code },
            'Rate-limited listing ads — skipping rest of this campaign',
          );
          adsRateLimited = true;
          break;
        }
        throw err;
      }
    }

    if (adsRateLimited) {
      rateLimitedCampaigns.push({ id: c.id, name: c.name, phase: 'ads' });
    }

    results.push({ campaign: campaignSnap, adSets: adSetSnaps, ads: adSnaps });
    adSetCount += adSetSnaps.length;
    adCount += adSnaps.length;
    logger.debug(
      {
        campaignId: c.id,
        name: c.name,
        adSets: adSetSnaps.length,
        ads: adSnaps.length,
      },
      'Campaign synced',
    );
  }

  logger.info(
    {
      connectionId,
      campaigns: results.length,
      adSets: adSetCount,
      ads: adCount,
      rateLimitedCount: rateLimitedCampaigns.length,
    },
    'Account sync complete',
  );

  return {
    campaignCount: results.length,
    adSetCount,
    adCount,
    rateLimitedCampaigns,
    campaigns: results,
  };
}
