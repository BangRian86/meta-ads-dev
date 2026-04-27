import { fetchObject, type MetaObjectStatus } from './meta-objects.js';
import type { ObjectRef } from './schema.js';

export interface ParentChain {
  self: MetaObjectStatus;
  adset?: MetaObjectStatus;
  campaign?: MetaObjectStatus;
}

/**
 * Loads the target plus its parent objects so blocker logic can check the full
 * delivery chain. Issues parent fetches in parallel where possible.
 */
export async function loadChain(
  connectionId: string,
  target: ObjectRef,
): Promise<ParentChain> {
  const self = await fetchObject(connectionId, target);

  if (target.type === 'campaign') {
    return { self };
  }

  if (target.type === 'adset') {
    if (!self.campaignId) {
      throw new Error(`Adset ${target.id} response missing campaign_id`);
    }
    const campaign = await fetchObject(connectionId, {
      type: 'campaign',
      id: self.campaignId,
    });
    return { self, campaign };
  }

  // ad
  if (!self.adsetId || !self.campaignId) {
    throw new Error(`Ad ${target.id} response missing adset_id or campaign_id`);
  }
  const [adset, campaign] = await Promise.all([
    fetchObject(connectionId, { type: 'adset', id: self.adsetId }),
    fetchObject(connectionId, { type: 'campaign', id: self.campaignId }),
  ]);
  return { self, adset, campaign };
}
