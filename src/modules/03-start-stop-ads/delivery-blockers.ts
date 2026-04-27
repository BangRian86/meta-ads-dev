import type { ParentChain } from './parent-chain.js';
import type { MetaObjectStatus } from './meta-objects.js';
import type { ObjectRef } from './schema.js';

export type BlockerCode =
  | 'self_deleted'
  | 'self_archived'
  | 'disapproved'
  | 'pending_review'
  | 'pending_billing'
  | 'with_issues'
  | 'in_process'
  | 'parent_paused'
  | 'parent_deleted'
  | 'parent_archived'
  | 'parent_disapproved';

export type BlockerLevel = 'self' | 'adset' | 'campaign';

export interface Blocker {
  code: BlockerCode;
  level: BlockerLevel;
  objectId: string;
  message: string;
}

/**
 * Returns the list of reasons the target cannot be activated. Empty array
 * means the activation should proceed.
 */
export function deriveActivationBlockers(
  target: ObjectRef,
  chain: ParentChain,
): Blocker[] {
  const blockers: Blocker[] = [];

  blockers.push(...selfBlockers(chain.self));

  if (target.type === 'ad' && chain.adset) {
    blockers.push(...parentBlockers(chain.adset, 'adset'));
  }
  if ((target.type === 'ad' || target.type === 'adset') && chain.campaign) {
    blockers.push(...parentBlockers(chain.campaign, 'campaign'));
  }

  return blockers;
}

function selfBlockers(self: MetaObjectStatus): Blocker[] {
  const out: Blocker[] = [];

  if (self.status === 'DELETED') {
    out.push({
      code: 'self_deleted',
      level: 'self',
      objectId: self.id,
      message: 'Object is DELETED — cannot be reactivated',
    });
  }
  if (self.status === 'ARCHIVED') {
    out.push({
      code: 'self_archived',
      level: 'self',
      objectId: self.id,
      message: 'Object is ARCHIVED — unarchive before activating',
    });
  }

  switch (self.effectiveStatus) {
    case 'DISAPPROVED':
      out.push({
        code: 'disapproved',
        level: 'self',
        objectId: self.id,
        message: 'Disapproved by Meta — fix policy issue and resubmit',
      });
      break;
    case 'PENDING_REVIEW':
      out.push({
        code: 'pending_review',
        level: 'self',
        objectId: self.id,
        message: 'Still pending Meta review — wait for approval',
      });
      break;
    case 'PENDING_BILLING_INFO':
      out.push({
        code: 'pending_billing',
        level: 'self',
        objectId: self.id,
        message: 'Billing info missing or invalid on the ad account',
      });
      break;
    case 'WITH_ISSUES':
      out.push({
        code: 'with_issues',
        level: 'self',
        objectId: self.id,
        message: 'Meta flagged issues that prevent delivery',
      });
      break;
    case 'IN_PROCESS':
      out.push({
        code: 'in_process',
        level: 'self',
        objectId: self.id,
        message: 'Object is in process — wait until Meta finishes',
      });
      break;
    default:
      break;
  }

  return out;
}

function parentBlockers(
  parent: MetaObjectStatus,
  level: 'adset' | 'campaign',
): Blocker[] {
  const out: Blocker[] = [];

  if (parent.status === 'DELETED') {
    out.push({
      code: 'parent_deleted',
      level,
      objectId: parent.id,
      message: `Parent ${level} is DELETED`,
    });
    return out;
  }
  if (parent.status === 'ARCHIVED') {
    out.push({
      code: 'parent_archived',
      level,
      objectId: parent.id,
      message: `Parent ${level} is ARCHIVED`,
    });
    return out;
  }
  if (parent.status === 'PAUSED') {
    out.push({
      code: 'parent_paused',
      level,
      objectId: parent.id,
      message: `Parent ${level} is PAUSED — unpause it first`,
    });
  }
  if (parent.effectiveStatus === 'DISAPPROVED') {
    out.push({
      code: 'parent_disapproved',
      level,
      objectId: parent.id,
      message: `Parent ${level} is disapproved by Meta`,
    });
  }

  return out;
}
