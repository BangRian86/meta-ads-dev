export {
  objectTypeSchema,
  campaignFieldsSchema,
  adSetFieldsSchema,
  adFieldsSchema,
  createCampaignInputSchema,
  createAdSetInputSchema,
  createAdInputSchema,
  duplicateInputSchema,
  syncCampaignInputSchema,
  syncObjectInputSchema,
  type ObjectType,
  type CampaignFields,
  type AdSetFields,
  type AdFields,
  type CreateCampaignInput,
  type CreateAdSetInput,
  type CreateAdInput,
  type DuplicateInput,
  type SyncCampaignInput,
  type SyncObjectInput,
} from './schema.js';

export {
  preflightCampaign,
  preflightAdSet,
  preflightAd,
  type PreflightResult,
} from './preflight.js';

export {
  createCampaignAtMeta,
  createAdSetAtMeta,
  createAdAtMeta,
  copyObjectAtMeta,
  deleteObjectAtMeta,
  type CopyOptions,
} from './meta-create.js';

export {
  fetchObject,
  listAccountCampaigns,
  listChildren,
  type ObjectReadResult,
} from './meta-read.js';

export {
  saveObjectSnapshot,
  findLatestSnapshot,
  listCampaignHierarchySnapshots,
} from './snapshot-store.js';

export {
  syncCampaignHierarchy,
  syncSingleObject,
  syncAccount,
  type CampaignHierarchyResult,
  type AccountSyncResult,
} from './sync.js';

export { duplicateObject, type DuplicateResult } from './duplicate.js';

export {
  createCampaign,
  createAdSet,
  createAd,
  syncCampaign,
  syncObject,
  PreflightFailedError,
  type CreateResult,
} from './service.js';
