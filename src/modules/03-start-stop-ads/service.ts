import { recordAudit, withAudit } from '../../lib/audit-logger.js';
import { logger } from '../../lib/logger.js';
import {
  statusChangeInputSchema,
  type ObjectRef,
  type StatusChangeInput,
  type MetaStatus,
  type MetaEffectiveStatus,
} from './schema.js';
import { fetchObject } from './meta-objects.js';
import { setObjectStatus } from './meta-mutations.js';
import { loadChain } from './parent-chain.js';
import {
  deriveActivationBlockers,
  type Blocker,
} from './delivery-blockers.js';

export type StatusChangeOutcome = 'success' | 'noop' | 'blocked';

export interface StatusChangeResult {
  outcome: StatusChangeOutcome;
  target: ObjectRef;
  previousStatus: MetaStatus;
  effectiveStatus: MetaEffectiveStatus;
  newStatus?: MetaStatus;
  blockers?: Blocker[];
  message: string;
}

/**
 * Pause a campaign / adset / ad. Pausing has no parent dependency, but we still
 * pre-read the object so we can:
 *   - return a no-op when already PAUSED
 *   - block when the object is DELETED/ARCHIVED (Meta would reject anyway)
 */
export async function pause(
  rawInput: StatusChangeInput,
): Promise<StatusChangeResult> {
  const input = statusChangeInputSchema.parse(rawInput);
  const { connectionId, target, actorId } = input;
  const operationType = `${target.type}.pause`;

  const self = await fetchObject(connectionId, target);

  if (self.status === 'PAUSED') {
    logger.info({ target }, 'Pause requested but object already PAUSED — no-op');
    return {
      outcome: 'noop',
      target,
      previousStatus: self.status,
      effectiveStatus: self.effectiveStatus,
      newStatus: 'PAUSED',
      message: 'Object is already paused',
    };
  }

  if (self.status === 'DELETED' || self.status === 'ARCHIVED') {
    const blockers: Blocker[] = [
      {
        code: self.status === 'DELETED' ? 'self_deleted' : 'self_archived',
        level: 'self',
        objectId: self.id,
        message: `Object is ${self.status} — pause not applicable`,
      },
    ];
    await recordAudit(
      {
        connectionId,
        operationType,
        targetType: target.type,
        targetId: target.id,
        actorId: actorId ?? null,
        requestBody: { status: 'PAUSED' },
      },
      {
        status: 'failed',
        errorCode: 'blocked',
        errorMessage: blockers.map((b) => b.message).join('; '),
        durationMs: 0,
      },
    );
    return {
      outcome: 'blocked',
      target,
      previousStatus: self.status,
      effectiveStatus: self.effectiveStatus,
      blockers,
      message: 'Cannot pause: object is in a terminal state',
    };
  }

  await withAudit(
    {
      connectionId,
      operationType,
      targetType: target.type,
      targetId: target.id,
      actorId: actorId ?? null,
      requestBody: { status: 'PAUSED' },
    },
    () => setObjectStatus(connectionId, target, 'PAUSED'),
  );

  return {
    outcome: 'success',
    target,
    previousStatus: self.status,
    effectiveStatus: self.effectiveStatus,
    newStatus: 'PAUSED',
    message: `Paused ${target.type} ${target.id}`,
  };
}

/**
 * Unpause (set ACTIVE) a campaign / adset / ad. Validates the parent chain and
 * returns blockers without contacting Meta if delivery is not ready.
 */
export async function unpause(
  rawInput: StatusChangeInput,
): Promise<StatusChangeResult> {
  const input = statusChangeInputSchema.parse(rawInput);
  const { connectionId, target, actorId } = input;
  const operationType = `${target.type}.unpause`;

  const chain = await loadChain(connectionId, target);
  const self = chain.self;

  if (self.status === 'ACTIVE') {
    logger.info({ target }, 'Unpause requested but object already ACTIVE — no-op');
    return {
      outcome: 'noop',
      target,
      previousStatus: self.status,
      effectiveStatus: self.effectiveStatus,
      newStatus: 'ACTIVE',
      message: 'Object is already active',
    };
  }

  const blockers = deriveActivationBlockers(target, chain);
  if (blockers.length > 0) {
    await recordAudit(
      {
        connectionId,
        operationType,
        targetType: target.type,
        targetId: target.id,
        actorId: actorId ?? null,
        requestBody: { status: 'ACTIVE' },
      },
      {
        status: 'failed',
        errorCode: 'blocked',
        errorMessage: blockers.map((b) => `[${b.code}] ${b.message}`).join('; '),
        responseBody: { blockers },
        durationMs: 0,
      },
    );
    return {
      outcome: 'blocked',
      target,
      previousStatus: self.status,
      effectiveStatus: self.effectiveStatus,
      blockers,
      message: `Cannot activate ${target.type}: ${blockers.length} blocker(s) found`,
    };
  }

  await withAudit(
    {
      connectionId,
      operationType,
      targetType: target.type,
      targetId: target.id,
      actorId: actorId ?? null,
      requestBody: { status: 'ACTIVE' },
    },
    () => setObjectStatus(connectionId, target, 'ACTIVE'),
  );

  return {
    outcome: 'success',
    target,
    previousStatus: self.status,
    effectiveStatus: self.effectiveStatus,
    newStatus: 'ACTIVE',
    message: `Activated ${target.type} ${target.id}`,
  };
}
